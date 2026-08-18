# DEPLOY_HOSTED.md — Hosted Demo (AWS EC2 + GHCR + DuckDNS + Caddy)

This runbook deploys the MarketMind AI demo so the team can visit a public
link at any time. It targets a low-cost stack: an AWS EC2 instance (paid from
promotional credit), images built by GitHub Actions and pulled from a public
GHCR registry, a free DuckDNS subdomain, Caddy for automatic HTTPS, and real
AI providers (Gemini / OpenRouter / R2) with email+password login.

> Everything below is an operation. Never present simulation data as real, and
> never ship a build nobody on the team can explain.

## Goal & cost

| Item | Choice | Cost |
| --- | --- | --- |
| Compute | AWS EC2 `t3.medium` (2 vCPU / 4 GB x86, Ubuntu 24.04) in `eu-central-1` | Paid from credit (~$30-37/mo incl. public IPv4) |
| Images | On-box `docker compose build` (see Phase 0 note) | Free |
| Domain | `marketmindai.duckdns.org` | Free |
| HTTPS | Caddy + Let's Encrypt | Free |
| AI providers | Gemini / OpenRouter / Cloudflare R2 (existing dev keys) | Free tier |
| Billing | `BILLING_PROVIDER=fake` (no real payments) | Free |

Repo files for this deployment:

- `apps/api/Dockerfile` — NestJS production image (`node dist/src/main`)
- `apps/web/Dockerfile` — Next.js production image (`next start`)
- `services/ai/Dockerfile` — FastAPI image (uv, includes contracts + corpus)
- `.github/workflows/build-push-images.yml` — builds + pushes the 3 images to GHCR on `main`
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

## Phase 0 — Build & publish images (one-time + on every `main` push)

The `build-push-images.yml` workflow builds `api`, `web`, `ai` from the repo
root and pushes to GHCR as `ghcr.io/arabe3/marketmind-ai-{api,web,ai}:latest`
(+ commit SHA). It runs automatically on `main` pushes touching app code, or
manually via **Actions → build-push-images → Run workflow**.

> **Registry note (as of 2026-08):** the owner account `ARabee3` cannot push
> to GHCR — the registry refuses `permission_denied: create_package` for any
> PAT (even `admin:packages`), and the GHCR token endpoint grants zero scopes.
> This is a GitHub-account-level block, not a workflow issue. Until it is
> resolved, do **not** rely on the workflow. Build the images directly on the
> VM instead (Phase 3 step 4 below) — `docker-compose.prod.yml` keeps `build:`
> contexts alongside the GHCR `image:` tags, so on-box builds produce the same
> containers and bake in the correct `NEXT_PUBLIC_API_URL` from `CADDY_HOSTNAME`.

The web image bakes in `NEXT_PUBLIC_API_URL=https://marketmindai.duckdns.org/api/v1`
at build time (Next.js inlines `NEXT_PUBLIC_*`), so the public hostname is a
fixed build arg in the workflow and a fixed `build.args` entry in compose.

## Phase 1 — AWS resources

1. **Import your SSH key** — EC2 → Key Pairs → Import: paste the public key
   (`~/.ssh/id_ed25519.pub` on the dev machine). The matching private key
   already lives there, so `ssh ubuntu@<IP>` just works.
2. **Launch an instance**:
   - Name: `marketmind-demo`
   - Image: **Ubuntu 24.04 LTS**
   - Instance type: **`t3.medium`** (x86, 2 vCPU / 4 GB)
   - Key pair: the imported one
   - Storage: **40 GB gp3** (30 GB is free-tier eligible under 12 months)
3. **Security group** (create or edit): allow inbound **TCP 22, 80, 443**
   from `0.0.0.0/0`.
4. **Elastic IP** — Allocate one and **associate** it with the instance so the
   public IP never changes. (AWS charges ~$3.60/mo for the public IPv4.)
5. **DuckDNS** — set the A record `marketmindai` → the Elastic IP.

## Phase 2 — VM base setup

SSH in, then:

```bash
# 1. Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo systemctl enable --now docker

# 2. Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 3. Re-login so docker works without sudo, then verify:
docker --version && docker compose version
```

## Phase 3 — Deploy & bootstrap

On the VM:

```bash
# 1. Clone the repo on the main branch
git clone https://github.com/ARabee3/marketmind-ai.git && cd marketmind-ai
git checkout main

# 2. Env files: API + AI provider secrets (these are gitignored locally;
#    copy them from your dev machine via scp — they contain real provider keys)
scp apps/api/.env    user@IP:~/marketmind-ai/apps/api/.env
scp services/ai/.env user@IP:~/marketmind-ai/services/ai/.env

# 3. Prod compose env
cp infra/docker/.env.prod.example infra/docker/.env.prod
nano infra/docker/.env.prod   # set CADDY_HOSTNAME + POSTGRES_PASSWORD

# 4. Build images on the box and start (GHCR push is blocked on this account —
#    build locally instead of pulling)
docker compose -f infra/docker/docker-compose.prod.yml build api
docker compose -f infra/docker/docker-compose.prod.yml build web
docker compose -f infra/docker/docker-compose.prod.yml build ai
docker compose -f infra/docker/docker-compose.prod.yml up -d
docker compose -f infra/docker/docker-compose.prod.yml ps
```

> Build sequentially (one image at a time) on a `t3.medium` — parallel
> builds can exhaust the 4 GB of RAM.

> In `services/ai/.env`, keep `KNOWLEDGE_SOURCE_DIR=Docs/marketing-knowledge`
> (the compose file overrides `AI_ORCHESTRATION_ENABLED=true` and
> `CONTENT_ASSET_STORAGE_DIR=/data/content-assets` so R2 is used for public
> assets).

### Bootstrap the database

The seed scripts refuse to run without their env vars, so add these to
`apps/api/.env` on the VM first (gitignored; use a strong password):

```bash
# apps/api/.env (append)
ADMIN_EMAIL=admin@marketmind.ai
ADMIN_NAME=MarketMind Admin
ADMIN_PASSWORD=<strong admin password>
DEMO_OWNER_EMAIL=demo-owner@marketmind.test
```

Then run migrations and seeds:

```bash
docker compose -f infra/docker/docker-compose.prod.yml run --rm api npx prisma migrate deploy
docker compose -f infra/docker/docker-compose.prod.yml run --rm api npm run seed:admin-user -w @marketmind/api
docker compose -f infra/docker/docker-compose.prod.yml run --rm api npm run seed:demo-owner -w @marketmind/api
```

`seed:demo-owner` prints a real refresh-token JWT — that is the demo owner's
login cookie, so the demo link works without a Google handshake.

### Sync marketing knowledge into Qdrant

```bash
docker compose -f infra/docker/docker-compose.prod.yml run --rm ai \
  python -m app.knowledge.ingestion.cli ingest --actor deployment-bootstrap --repo-root /app
```

(If a live source is flaky, append `--no-strict-sources` — but do **not**
present that corpus as verified.)

### Smoke test from the VM

```bash
curl -s https://marketmindai.duckdns.org/api/v1/health
curl -sI https://marketmindai.duckdns.org/ | head -1
```

## Phase 4 — Public link & handoff

1. Confirm `https://marketmindai.duckdns.org` loads and logs in with the
   seeded demo owner.
2. Test a browser login on the public origin: cookies must persist and the
   dashboard must render. If login fails, the web→API proxy or the cookie
   flags are the first suspects (see "Troubleshooting").
3. Share the link + demo credentials with the team, noting:
   - Billing is fake/prepaid demo; real publishing is never automated.
   - Content/public asset storage uses real R2 credentials already in
     `services/ai/.env`.

## OAuth dashboard registration (Google / Meta)

The production API is a single HTTPS origin, so every OAuth callback must be
registered in the provider dashboards with the **exact HTTPS URI** below
(`docker-compose.prod.yml` overrides the localhost dev values with
`https://${CADDY_HOSTNAME}/...`):

| Provider | Redirect URI to register |
| --- | --- |
| Google Login (API side) | `https://marketmindai.duckdns.org/api/v1/auth/google/callback` |
| Facebook Login (Meta app) | `https://marketmindai.duckdns.org/api/v1/auth/facebook/callback` |
| Meta publishing target OAuth | `https://marketmindai.duckdns.org/api/v1/publishing-targets/meta/callback` |

- These three are the only URI-bearing env vars the compose file overrides;
  every other API env var keeps its `localhost` value from `apps/api/.env`,
  which is fine because only these three are used in browser/server-to-server
  OAuth round trips.
- Until they are registered, Google/Facebook/Meta flows fail with redirect-URI
  mismatches while email+password login keeps working.

> **n8n publishing webhook is demo-inert.** `PUBLISHING_N8N_WEBHOOK_URL` still
> points at `http://localhost:5678/webhook/publishing-dispatch` and no n8n runs
> on the box, so the publishing-automation handoff is not exercised in the
> hosted demo. The demo's publishing path is the deterministic manual/simulated
> flow — never present automated publishing as real.

## Troubleshooting

- **Login works on localhost but fails on the VM** — cookie lost. Check
  `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=lax`, `WEB_ORIGIN`/`APP_URL` =
  `https://marketmindai.duckdns.org`, and that all web requests go to the same
  origin (no mixed `http://localhost:3001`).
- **Images pull as `latest` stale** — redeploy after a `main` push re-runs
  `build-push-images.yml`, then `docker compose pull`.
- **`/api/*` 404** — confirm Caddy forwards paths without stripping
  (`infra/caddy/Caddyfile`).
- **Container restarts** — `docker compose ... logs -f api` / `ai`. Common:
  DB not migrated, provider key expired, Qdrant not reachable.
- **`web` shows unhealthy though the server is up** — the container healthcheck
  uses `wget http://localhost:3000/`, but `localhost` resolves to `::1`
  (IPv6) while Next.js binds IPv4 only. The compose file uses `127.0.0.1`;
  keep it that way when editing.
- **Compose warns about blank `CADDY_HOSTNAME`** — you must pass the env file
  explicitly because it is not named `.env`:
  `docker compose --env-file infra/docker/.env.prod -f infra/docker/docker-compose.prod.yml ...`
- **Knowledge sync fails with `SOURCE_RESOLUTION_FAILED` (HTTP 403)** — some
  cited government sites (e.g. `moe.gov.eg`) block datacenter IPs at the WAF
  for any user-agent. Append `--no-strict-sources` per the runbook note, and
  do **not** present that corpus as fully verified.
- **DuckDNS IP drift** — the Elastic IP is fixed; only re-point the A record
  if you ever release it.
- **Credit/overrun** — set an AWS billing alarm (~$80) so the promotional
  credit is never exhausted silently.

## Reset / teardown

```bash
docker compose -f infra/docker/docker-compose.prod.yml down
docker volume ls | grep marketmind_prod   # list data volumes
# AWS: terminate the instance; release the Elastic IP (releases IPv4 charge).
```