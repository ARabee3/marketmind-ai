# 2. API, Database & Deployment Guide

## 1. Purpose & scope

This is the operational reference for the backend: how the API is shaped, what the data
model looks like, and how the system is built, tested, and deployed. It documents the
NestJS REST surface (`apps/api`) and the internal FastAPI surface (`services/ai`), the
Prisma/PostgreSQL data model, and the Docker/Caddy hosted deployment.

## 2. API conventions

- **Public base path:** `/api/v1` (set globally in `apps/api/src/main.ts` via
  `setGlobalPrefix("api/v1", { exclude: ["internal/*splat"] })`).
- **Internal base path:** `/internal/v1/...` — excluded from the global prefix; used only
  for the n8n / Meta-executor callback boundary, not the owner-facing surface.
- **No OpenAPI/Swagger.** `@nestjs/swagger` is not a dependency and `SwaggerModule` is
  never referenced (verified). The **authoritative request/response schema is
  `packages/contracts`** (shared TS + Python types) together with the NestJS DTOs under
  each module's `dto/`. The worked examples below use exact fields for the endpoint shown;
  consult the referenced DTOs/contracts for routes not expanded here.
- **Auth:** JWT access token in `Authorization: Bearer <token>`; a rotating HttpOnly
  `refreshToken` cookie backs `POST /auth/refresh` and `GET /auth/session`.
- **Authorization:** RBAC via `@Permissions(...)` + `PermissionsGuard`.
- **Validation:** global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `transform`) — unknown body fields are rejected.
- **Error shape:** a single global `AllExceptionsFilter` returns a stable
  `{ code, message }` object; expected 4xx keep their codes and unexpected errors are
  hidden behind a generic 500.
- **Throttling:** `@nestjs/throttler` guards sensitive routes (e.g. login/register are
  limited to 5 requests / 15 min).
- **Idempotency / signatures:** `Idempotency-Key` and `X-Billing-Signature` are allowed
  request headers; the raw body is preserved for billing-webhook HMAC verification.

## 3. NestJS REST surface

23 controllers under `/api/v1/`. Grouped by domain (representative routes):

- **auth** — `POST register|login|refresh|logout|forgot-password|reset-password|verify-email|resend-verification`; `GET me|session|google|google/callback`
- **discovery** — `POST start`, `:sessionId/respond|transcribe|summarize|confirm-profile`; `GET :sessionId/status`; `SSE :sessionId/stream`
- **strategies** — `POST` create, `:id/generate|decisions|retry`; `PUT :id/brief`; `GET :id`, `:id/versions`, `:id/versions/:version`, `:id/retrieval`, `:id/progress`
- **content** — `content-cycles` (create/pause/resume, weeks context/generate), `content-packs` (progress/retry), `content-assets`, `publication-candidates`; and **content v2**: workspace, editorial-profile (GET/PATCH/reset), cta-library CRUD, media upload/get/revoke, week-plans, pack regenerate, item edits/rewrite/media generate+attach
- **publishing** — `publishing-targets` (+ `meta/connect|select|reconnect|pending`, `meta/callback`), `publication-intents` (schedule, decisions, approvals, cancel/reschedule/retry, dispatch-export, dispatch-simulation, attempts, export/download), `publication-candidates`, `publishing/admin` (resync, resolve, sweep, attempts)
- **performance** — `performance/facebook`: overview, posts, posts/:id/snapshots, posts/:id/refresh; `performance/optimization`: readiness, proposals (POST/GET), proposals/:id, proposals/:id/decisions
- **billing** — `GET bundles|wallet|wallet/ledger|transactions`; `POST checkouts|sandbox/confirm|webhooks/:provider`
- **misc** — `journey/current`, `rbac/me/permissions`, `admin/users|revenue/summary|subscriptions`, `facebook` auth/connections, `health`, `/`

### 3.1 Worked example — `POST /api/v1/auth/login`

Verified from `apps/api/src/modules/auth/auth.controller.ts`. Throttled to 5 / 15 min;
returns the access token in the body and sets the refresh token as an HttpOnly cookie.

Request:
```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "owner@example.com", "password": "<password>" }
```
Response `200 OK` (+ `Set-Cookie: refreshToken=<...>; HttpOnly; SameSite=Lax`):
```json
{
  "accessToken": "<jwt>",
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "owner@example.com",
    "fullName": null,
    "roles": ["OWNER"],
    "isEmailVerified": true,
    "lastLoginAt": null,
    "createdAt": "2026-08-20T10:00:00.000Z",
    "updatedAt": "2026-08-20T10:15:00.000Z"
  }
}
```
Error `429` (shape is representative of all errors):
```json
{ "code": "RATE_LIMIT_EXCEEDED", "message": "Too many requests" }
```
> The response fields match `SafeUser` in `apps/api/src/modules/auth/auth.service.ts`;
> timestamps are serialized as ISO-8601 strings by the HTTP response.

### 3.2 Worked example — `POST /api/v1/discovery/start`

Verified from `apps/api/src/modules/discovery/discovery.controller.ts`. Requires a JWT
and the `DISCOVERY_START` permission; returns `202 Accepted` because discovery research
runs asynchronously on a queue — the client then watches
`GET /api/v1/discovery/:sessionId/status` or the
SSE stream.

Request:
```http
POST /api/v1/discovery/start
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "intake": {
    "business_name": "Koshary Corner",
    "business_type": "quick service restaurant",
    "city": "Cairo",
    "area": "Nasr City"
  },
  "language_mode": "mixed"
}
```
Response `202 Accepted`:
```json
{
  "session_id": "11111111-1111-4111-8111-111111111111",
  "status": "researching",
  "progress_ws_url": "/ws/v1/discovery",
  "status_url": "/api/v1/discovery/11111111-1111-4111-8111-111111111111/status",
  "accepted_at": "2026-08-20T10:15:00.000Z"
}
```
> Voice input: `POST /api/v1/discovery/:sessionId/transcribe` accepts a multipart
> `audio` field, **WAV only**, max 5 MB (rejects with `DISCOVERY_TRANSCRIPTION_INVALID_AUDIO`
> otherwise).

## 4. Internal routes (n8n / executor boundary)

Outside `/api/v1`, under `/internal/v1/...` (not owner-reachable):
`publishing/candidates/ingest`, `publishing/execute-meta`,
`publishing/media-fetch/:assetId`, `publishing/assets/:id`,
`publishing/dispatch/:attemptId/callback`. These are the automation-executor contract.
In the hosted demo the automation executor is not running (see §9).

## 5. AI service surface (FastAPI, internal)

From `services/ai/app/main.py` — routers: `health`, `discovery`, `content`, `search`,
`strategy`, `optimization`. All AI routes are `POST` under `/internal/v1/ai/` unless
noted:

- `GET /health`
- `discovery/`: `start`, `respond`, `summarize`, `transcribe`
- `strategy/`: `retrieve`, `score`, `generate`, `revise`
- `content/`: `generate`, `revise`, `v2/plan`, `v2/generate`, `v2/revise`, `assets/generate-static`
- `search/`: `query-plan`, `evidence-triage`
- `optimization/propose`

Note: the AI service mounts **no** orchestration router — the agentic graph is not on any
HTTP path (see Document 3 §6).

## 6. Database

**One Prisma schema** (`apps/api/prisma/schema.prisma`) on **PostgreSQL 16** —
**86 models, 11 enums** (verified). Vector data lives in Qdrant, not Postgres; chunk
*text* and governance live in Postgres.

Model clusters (representative members):

| Cluster | Models |
|---|---|
| Auth / RBAC | `User`, `RefreshSession`, `RoleEntity`, `Permission`, `RolePermission`, `UserRole`, `ActionToken`, `FederatedIdentity` |
| Business / Discovery | `Business`, `DiscoverySession`, `PreparedDiscoveryIntake`, `SocialLink`, `SocialConnection`, `IntelligenceRun`, `SourceRef`, `ResearchObservation`, `ConversationHook`, `KnowledgeGap`, `DiscoveryMessage`, `BusinessProfileDraft`, `BusinessProfileVersion`, `AgentRun`, `DiscoveryProgressEvent` |
| Marketing knowledge | `MarketingKnowledgeEntry` (+ `Version`, `SourceRef`, `Chunk`, `IngestionRun`, `IngestionError`) |
| Strategy | `Strategy`, `StrategyBrief`, `StrategyVersion`, `StrategyDecision`, `StrategyProgressEvent`, `StrategyRetrievalRun`/`Item`/`Gap` |
| Content | `ContentCycle`, `ContentWeekContext`, `ContentPack`, `ContentItem`, `ContentItemVersion`, `ContentAsset`, `ContentEditorialProfile`, `ContentCtaLibraryEntry`, `ContentMediaLibraryEntry`, `ContentWeekPlan`, `ContentPostPlan`, `ContentGenerationRun`, `ContentProgressEvent`, `ContentDecision`, `ContentJobOutbox` |
| Publishing | `PublicationCandidate` (+ `Status`, `Outbox`), `PublishingTarget`, `PublishingCredential`, `PublishingProviderConnection`, `PublishingConnectionAudit`, `MetaOAuthState`, `PublishingIntent`, `PublishingApproval`, `PublishingAttempt`, `PublishingResult`, `PublishingCallbackIdentity`, `PublishingExportMetadata` |
| Performance / Optimization | `PerformanceSyncWindow`, `MetricSnapshot`, `OptimizationProposal`, `OptimizationDecision`, `ApprovedOptimizationInstruction` |
| Billing | `BillingAccount`, `BillingPointBalance`, `BillingPointLedger`, `BillingPrice`, `BillingSubscription`, `BillingCheckoutAttempt`, `BillingPaymentTransaction`, `BillingProviderEvent`, `BillingUsageLedger`, `BillingProviderCostLedger`, `BillingOutbox` |

For the ERD in the submission, render **per cluster** rather than all 86 tables at once,
and generate it from the live schema (e.g. `prisma-erd-generator` or
`prisma migrate diff`) so it can never drift from the code.

**Migrations & seeds:** 34 timestamped migrations under `apps/api/prisma/migrations/`
(+ `migration_lock.toml`), applied with `prisma migrate deploy`. Seed scripts:
`seed.ts`, `scripts/seed-admin-user.ts`, `seed-demo-owner.ts`, `seed-publishing-demo.ts`.
 Outbox + status side-tables reflect the event-driven design in Document 1 §5.3.

## 7. Deployment (hosted demo)

Source of truth: `DEPLOY_HOSTED.md` + `infra/docker/docker-compose.prod.yml` +
`infra/caddy/Caddyfile`.

- **Host:** a single AWS EC2 `t3.medium` (Ubuntu 24.04).
- **Compose = 7 services** (verified in `docker-compose.prod.yml`): `postgres:16-alpine`,
  `redis:7-alpine`, `qdrant/qdrant:v1.18.0`, `ai`, `api`, `web`, `caddy:2-alpine` — each
  with healthchecks and dependency ordering.
- **TLS & DNS:** DuckDNS hostname + Caddy (Let's Encrypt). Only Caddy publishes ports
  `80/443` (and `443/udp`); Postgres/Redis/Qdrant have **no published ports** (internal
  only).
- **Single-origin routing (Caddy):** `/api/*`, `/internal/*`, `/socket.io/*` → `api:3001`;
  everything else → `web:3000`. Required by the host-scoped `SameSite=lax` refresh cookie.

- **Config precedence:** app secrets come from gitignored `apps/api/.env` and
  `services/ai/.env` via `env_file`; host-specific values (`POSTGRES_PASSWORD`,
  `CADDY_HOSTNAME`) come from gitignored `infra/docker/.env.prod`. Prod compose also sets
  `NODE_ENV=production`, `COOKIE_SECURE=true`, `BILLING_PROVIDER=fake`,
  `ASSET_STORAGE_PROVIDER=r2`, and the HTTPS OAuth/publishing callback URLs.

**Local development:** `infra/docker/docker-compose.local.yml` (Postgres :5433, Redis
:6379) + optional `docker-compose.qdrant.yml` (:6333). One-command runners: `npm run dev`
(no migrations), `npm run dev:full` (migrations + knowledge sync), `npm run strategy:dev`
(full strategy slice incl. Qdrant).

## 8. CI/CD

The API, web, and AI workflows run on matching pull requests and pushes to `main`.
The image workflow runs on pushes to `main` or manual dispatch; it does not run on
pull requests. At the time of writing, the repository has no branch-protection rule,
so these are available checks rather than enforced merge gates.

| Workflow | Verified jobs and trigger |
|---|---|
| `api-ci.yml` | **build-and-unit**: contracts check → build API → Jest unit (`--runInBand`). **integration**: spins up Postgres 16 + Redis 7 services, generates Prisma client, `prisma migrate deploy`, runs E2E + DB integration tests. Runs on matching PRs and pushes to `main`. |
| `web-ci.yml` | **check** (typecheck + lint + vitest + dictionary parity), **build** (production `next build`), **e2e** (Playwright, chromium). Runs on matching PRs and pushes to `main`. |
| `ai-ci.yml` | **eval-smoke**, **content-eval** (deterministic suite + `--hard-guardrails-only` threshold), **agentic-phase4-5** safety smoke, **phase0-durability** (Postgres-backed LangGraph interrupt/resume gate). Uses `uv sync --frozen`; runs on matching PRs and pushes to `main`. |
| `build-push-images.yml` | Matrix builds `api`/`web`/`ai` Docker images and pushes to `ghcr.io/<owner>/marketmind-ai-{api,web,ai}:latest` + `:<sha>`. Runs on `main` pushes or manual dispatch only. |

## 9. Verified vs aspirational — read before you write "it's live"

These are the exact places where naïve docs overclaim. State them plainly in the
submission:

| Claim | Reality |
|---|---|
| GHCR images are pushed by CI and pulled on the server | `build-push-images.yml` exists, **but** `DEPLOY_HOSTED.md` records that the owner account **cannot push to GHCR** (`permission_denied`); the runbook builds images **on the VM** instead. So the workflow is effectively unused for the hosted demo. |
| Automated publishing to social platforms works | The n8n publishing webhook is **demo-inert** — `PUBLISHING_N8N_WEBHOOK_URL` points at `localhost:5678` and no n8n runs on the box. The demo uses the deterministic **manual/simulated** publishing path. Assets exist under `infra/n8n/` (one workflow + fixtures) but are not deployed. |
| Payments are live | Prod runs `BILLING_PROVIDER=fake`. `paymob` is implemented; `geidea` is **not implemented in this release**. |
| OAuth "just works" | Google/Meta/Facebook require **manual dashboard registration** of the exact HTTPS callback URIs (see the `*_CALLBACK_URL` / `*_REDIRECT_URI` env in prod compose) or the flows fail. Email+password always works. |

## 10. Runbooks & references

- Deployment: `DEPLOY_HOSTED.md`, `infra/README.md`
- n8n automation assets: `infra/n8n/README.md`, `infra/n8n/workflows/publishing-v1.json`
- Strategy verification: `npm run strategy:verify` / `strategy:readiness`
  (`scripts/check-strategy-live-readiness.mjs`)
- Contracts (schema source of truth): `packages/contracts/`
