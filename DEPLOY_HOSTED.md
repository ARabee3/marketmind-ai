# DEPLOY_HOSTED.md — Always-Free Hosted Demo (Oracle Cloud + DuckDNS + Caddy)

This runbook deploys the MarketMind AI demo so the team can visit a public
link at any time. It targets a **100% free** stack: Oracle Cloud Always Free
Ampere VM, a free DuckDNS subdomain, Caddy for automatic HTTPS, and real AI
providers (Gemini / OpenRouter / R2) with email+password login.

> Everything below is an operation. Never present simulation data as real, and
> never ship a build nobody on the team can explain.

## Goal & cost

| Item | Choice | Cost |
| --- | --- | --- |
| VM | Oracle Cloud Always Free (Ampere A1, 4 OCPU / 24 GB ARM) | Free |
| Domain | `marketmind.duckdns.org` | Free |
| HTTPS | Caddy + Let's Encrypt | Free |
| AI providers | Gemini / OpenRouter / Cloudflare R2 (existing dev keys) | Free tier |
| Billing | `BILLING_PROVIDER=fake` (no real payments) | Free |

The repo files for this deployment (Phase 1) are:

- `apps/api/Dockerfile` — NestJS production image (`node dist/src/main`)
- `apps/web/Dockerfile` — Next.js production image (`next start`)
- `services/ai/Dockerfile` — FastAPI image (uv, includes contracts + corpus)
- `infra/docker/docker-compose.prod.yml` — full stack (postgres, redis, qdrant, ai, api, web, caddy)
- `infra/docker/.env.prod.example` — copy to `.env.prod`
- `infra/caddy/Caddyfile` — single-origin reverse proxy

## Architecture (why single origin)

The refresh-token cookie is **host-scoped and `SameSite=lax`** (`apps/api`
auth controller), and the web session middleware reads that cookie from the
web origin (`apps/web/src/proxy.ts`). If web and API had different origins,
the browser would not send the cookie and login would break. Therefore Caddy
serves one hostname and routes paths:

| Path | Target |
| --- | --- |
| `/api/*`, `/internal/*`, `/socket.io/*` | `api:3001` (path kept, `/api/v1` prefix preserved) |
| everything else | `web:3000` |

## Phase 2 — Oracle Cloud VM

1. In Oracle Cloud Console, create a **Compute instance**:
   - Image: **Canonical Ubuntu 24.04 (Minimal)** or 22.04.
   - Shape: **VM.Standard.A1.Flex** (Always Free). Allocate 4 OCPU / 24 GB.
   - Network: default VCN; add a rule allowing **TCP 22 (SSH)**, **TCP 80**, **TCP 443** from anywhere.
   - SSH: add your public key; save the private key.
2. Open the Ubuntu 24.04 **Firewall** when the VM is ready:
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
3. Set the VM **Public IP** to **Reserved** (Always Free has one reserved IP) so it never changes.

## Phase 3 — VM base setup

SSH in, then:

```bash
# 1. Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo systemctl enable --now docker

# 2. Re-login so docker works without sudo, then verify:
docker --version && docker compose version
```

## Phase 4 — Deploy & bootstrap

On the VM:

```bash
# 1. Clone the repo on the main branch
git clone https://github.com/<org>/marketmind-ai.git && cd marketmind-ai
git checkout main

# 2. Env files: API + AI provider secrets (these are gitignored locally;
#    copy them from your dev machine via scp — they contain real provider keys)
scp apps/api/.env    user@IP:~/marketmind-ai/apps/api/.env
scp services/ai/.env user@IP:~/marketmind-ai/services/ai/.env

# 3. Prod compose env
cp infra/docker/.env.prod.example infra/docker/.env.prod
nano infra/docker/.env.prod   # set CADDY_HOSTNAME + POSTGRES_PASSWORD

# 4. Build and start (several minutes on the ARM VM)
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
docker compose -f infra/docker/docker-compose.prod.yml ps
```

> In `services/ai/.env`, set `AI_ORCHESTRATION_ENABLED=true` (the compose file
> already overrides it) and keep `KNOWLEDGE_SOURCE_DIR=Docs/marketing-knowledge`.
> `CONTENT_ASSET_STORAGE_DIR` is overridden to the `/data/content-assets`
> volume so R2 is used for public assets.

### Bootstrap the database

```bash
# Apply Prisma migrations
docker compose -f infra/docker/docker-compose.prod.yml run --rm api npx prisma migrate deploy

# Seed the admin + demo owner accounts
docker compose -f infra/docker/docker-compose.prod.yml run --rm api npm run seed:admin-user -w @marketmind/api
docker compose -f infra/docker/docker-compose.prod.yml run --rm api npm run seed:demo-owner -w @marketmind/api
```

### Sync marketing knowledge into Qdrant

```bash
docker compose -f infra/docker/docker-compose.prod.yml run --rm ai \
  python -m app.knowledge.ingestion.cli ingest --actor deployment-bootstrap --repo-root /app
```

(If a live source is flaky, append `--no-strict-sources` — but do **not**
present that corpus as verified.)

### Smoke test from the VM

```bash
curl -s https://marketmind.duckdns.org/api/v1/health
curl -sI https://marketmind.duckdns.org/ | head -1
```

## Phase 5 — Public link & handoff

1. Confirm `https://marketmind.duckdns.org` loads and logs in with the seeded
   demo owner.
2. Test a browser login on the public origin: cookies must persist and the
   dashboard must render. If login fails, the web→API proxy or the cookie
   flags are the first suspects (see "Troubleshooting").
3. Share the link + demo credentials with the team, noting:
   - Billing is fake/prepaid demo; real publishing is never automated.
   - Content/public asset storage uses real R2 credentials already in
     `services/ai/.env`.

## Troubleshooting

- **Login works on localhost but fails on the VM** — cookie lost. Check
  `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=lax`, `WEB_ORIGIN`/`APP_URL` =
  `https://marketmind.duckdns.org`, and that all web requests go to the same
  origin (no mixed `http://localhost:3001`).
- **`/api/*` 404** — confirm Caddy forwards paths without stripping
  (`infra/caddy/Caddyfile`).
- **Container restarts** — `docker compose ... logs -f api` / `ai`. Common:
  DB not migrated, provider key expired, Qdrant not reachable.
- **DuckDNS IP drift** — keep the VM IP reserved (Phase 2 step 3) or the
  subdomain will point at a dead IP.

## Reset / teardown

```bash
docker compose -f infra/docker/docker-compose.prod.yml down
docker volume ls | grep marketmind_prod   # list data volumes
```