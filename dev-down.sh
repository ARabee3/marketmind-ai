#!/usr/bin/env bash
# =============================================================================
# dev-down.sh — stop the services started by dev-up.sh.
#
# Order: NestJS API + AI service (kill), then Docker compose (Postgres).
# PIDs are read from output/dev-up-{api,ai}.pid when present; missing pids are
# handled gracefully (the service was likely started in another shell).
#
# Flags:
#   -v   also remove the Postgres volume (destructive — wipes all data)
# =============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/output"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.local.yml"

if [[ -t 1 ]]; then
  C_BLUE='\033[34m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_RESET='\033[0m'
else
  C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi
log()  { printf "${C_BLUE}▶${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}!${C_RESET} %s\n" "$*"; }

kill_pidfile() {
  local name="$1" file="$2" port="$3"
  local rc=0
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      log "Stopping $name (pid $pid)…"
      kill "$pid" 2>/dev/null || true
      for _ in {1..10}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.3
      done
      kill -9 "$pid" 2>/dev/null || true
      ok "$name stopped"
    else
      warn "$name pid $pid not alive (already stopped?)"
    fi
    rm -f "$file"
    return 0
  fi
  # No pidfile — fall back to port-based kill
  local p
  p="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | head -1 || true)"
  if [[ -n "$p" ]]; then
    log "Stopping $name on :$port (pid $p)…"
    kill "$p" 2>/dev/null || true
    sleep 1
  fi
  return 0
}

kill_pidfile "NestJS API"   "$LOG_DIR/dev-up-api.pid" 3001
kill_pidfile "AI service"  "$LOG_DIR/dev-up-ai.pid"  8000

# Also release the ports if anything is still lingering
for port in 3001 8000; do
  p="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | head -1 || true)"
  [[ -n "$p" ]] && { log "Killing lingering pid $p on :$port"; kill -9 "$p" 2>/dev/null || true; }
done

log "Stopping Docker compose (Postgres)…"
if [[ "${1:-}" == "-v" ]]; then
  docker compose -f "$COMPOSE_FILE" down -v
  ok "Docker stopped and volume removed (data wiped)"
else
  docker compose -f "$COMPOSE_FILE" down
  ok "Docker stopped (data volume kept — use ./dev-down.sh -v to wipe)"
fi

echo
ok "All services stopped."