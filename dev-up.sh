#!/usr/bin/env bash
# =============================================================================
# dev-up.sh — bring up all MarketMind local services in the right order.
#
#   1. Docker compose (PostgreSQL)
#   2. Prisma migrate + seed   (apps/api)
#   3. FastAPI AI service      (services/ai, uv run uvicorn)
#   4. NestJS API              (apps/api, npm run start:dev)
#
# Logs stream to ./output/dev-up-<service>.log and are tailed live.
# Use ./dev-down.sh to stop everything (Docker stays up by default; use -v in
# dev-down.sh to also wipe the Postgres volume).
#
# Flags:
#   --skip-migrate   skip prisma migrate + seed
#   --no-open        do not open the discovery playground in the browser
# =============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/output"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.local.yml"
API_DIR="$ROOT/apps/api"
AI_DIR="$ROOT/services/ai"
WEB_PAGE="$ROOT/apps/web/discovery-playground.html"

mkdir -p "$LOG_DIR"

# Colors
if [[ -t 1 ]]; then
  C_BLUE='\033[34m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_RESET='\033[0m'
else
  C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi

log() { printf "${C_BLUE}▶${C_RESET} %s\n" "$*"; }
ok()  { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn(){ printf "${C_YELLOW}!${C_RESET} %s\n" "$*"; }
die(){ printf "${C_RED}✗${C_RESET} %s\n" "$*" >&2; exit 1; }

SKIP_MIGRATE=0
OPEN_PAGE=1
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --no-open) OPEN_PAGE=0 ;;
    *) warn "Unknown flag: $arg" ;;
  esac
done

# --- preflight ---------------------------------------------------------------
command -v docker >/dev/null || die "docker not found in PATH"
command -v uv >/dev/null      || die "uv not found in PATH (install: curl -LsSf https://astral.sh/uv/install.sh | sh)"
command -v node >/dev/null    || die "node not found in PATH"
[[ -f "$API_DIR/.env" ]]      || die "apps/api/.env missing (copy from .env.example)"
[[ -f "$AI_DIR/.env" ]]       || die "services/ai/.env missing (copy from .env.example)"

pkill_at_port() {
  local port="$1" name="$2"
  local pid
  # `|| true` keeps set -e + pipefail from aborting when nothing is listening
  # (lsof exits 1 with no match).
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | head -1 || true)"
  if [[ -n "$pid" ]]; then
    warn "Port $port ($name) already in use (pid $pid) — killing…"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
}

# --- 1. Docker compose (Postgres) --------------------------------------------
log "Starting Docker compose (PostgreSQL)…"
docker compose -f "$COMPOSE_FILE" up -d

log "Waiting for Postgres to accept connections…"
for i in {1..30}; do
  if docker exec marketmind-postgres pg_isready -U marketmind -d marketmind_dev >/dev/null 2>&1; then
    ok "Postgres is ready"; break
  fi
  sleep 1
  [[ $i -eq 30 ]] && die "Postgres did not become ready within 30s"
done

# --- 2. Prisma migrate + seed -----------------------------------------------
if [[ $SKIP_MIGRATE -eq 1 ]]; then
  warn "Skipping prisma migrate + seed (--skip-migrate)"
else
  log "Running prisma migrate deploy…"
  (cd "$API_DIR" && npx prisma migrate deploy) || die "prisma migrate deploy failed"
  log "Running prisma seed…"
  # ts-node seed.ts instantiates PrismaClient directly and does not auto-load
  # .env (unlike the @nestjs/config module used at runtime), so export the
  # vars here before running it.
  set -a; source "$API_DIR/.env"; set +a
  (cd "$API_DIR" && npm run prisma:seed) || die "prisma seed failed"
  ok "Database migrated and seeded"
fi

# --- 3. AI service (uvicorn) -------------------------------------------------
pkill_at_port 8000 "AI service"
log "Starting FastAPI AI service on :8000…"
( cd "$AI_DIR" && uv run uvicorn app.main:app --reload --port 8000 \
    >"$LOG_DIR/dev-up-ai.log" 2>&1 ) &
AI_PID=$!
echo $AI_PID > "$LOG_DIR/dev-up-ai.pid"

log "Waiting for AI service /health…"
for i in {1..40}; do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ok "AI service is ready"; break
  fi
  if ! kill -0 "$AI_PID" 2>/dev/null; then
    die "AI service exited early — see $LOG_DIR/dev-up-ai.log"
  fi
  sleep 1
  [[ $i -eq 40 ]] && die "AI service did not become healthy on :8000 — see $LOG_DIR/dev-up-ai.log"
done

# --- 4. NestJS API -----------------------------------------------------------
pkill_at_port 3001 "NestJS API"
log "Starting NestJS API on :3001…"
( cd "$API_DIR" && npm run start:dev \
    >"$LOG_DIR/dev-up-api.log" 2>&1 ) &
API_PID=$!
echo $API_PID > "$LOG_DIR/dev-up-api.pid"

log "Waiting for API /api/v1/health…"
for i in {1..60}; do
  if curl -sf http://localhost:3001/api/v1/health >/dev/null 2>&1; then
    ok "NestJS API is ready"; break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    die "NestJS API exited early — see $LOG_DIR/dev-up-api.log"
  fi
  sleep 1
  [[ $i -eq 60 ]] && die "NestJS API did not become healthy on :3001 — see $LOG_DIR/dev-up-api.log"
done

# --- 5. Summary --------------------------------------------------------------
echo
ok "All services are up:"
printf "    Postgres : localhost:5432  (docker: marketmind-postgres)\n"
printf "    AI       : http://localhost:8000   (log: output/dev-up-ai.log, pid: %s)\n" "$AI_PID"
printf "    API      : http://localhost:3001/api/v1  (log: output/dev-up-api.log, pid: %s)\n" "$API_PID"

if [[ $OPEN_PAGE -eq 1 && -f "$WEB_PAGE" ]]; then
  log "Opening discovery playground…"
  open "$WEB_PAGE" 2>/dev/null || warn "open failed — open $WEB_PAGE manually"
fi

echo
printf "Tail logs: tail -f $LOG_DIR/dev-up-{ai,api}.log\n"
printf "Stop:      ./dev-down.sh\n"