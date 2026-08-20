# 1. Technical Architecture & System Design

## 1. Purpose & scope

This document describes the full-stack architecture of MarketMind AI: the deployable
units, how they are wired together, how a request flows through the system, and why the
main technology choices were made.

API-level detail (endpoints, schema, deployment mechanics) lives in [Document 2](./02_API_DATABASE_AND_DEPLOYMENT_GUIDE.md); AI
internals (LLM, RAG, agents) live in
[Document 3](./03_AI_RAG_AGENTIC_TECHNICAL_DOCUMENT.md).

## 2. System context

MarketMind AI is a single-owner web application for Egyptian SMEs. One business owner
signs in, is interviewed by a discovery agent, receives a research-grounded 12-week
marketing strategy, generates weekly content, approves it, publishes or exports it, and
then reviews Facebook performance and an optional AI optimization proposal. **A human
owner approves every consequential step** — this "owner-in-control" invariant shapes the
whole architecture (approval gates, no autonomous publishing, deterministic guardrails
around the LLM).

The end-to-end MVP journey:

```
Discovery ─► Research (RAG + trusted queries) ─► Strategy (12-week plan)
   │                                                      │
   ▼                                                      ▼
Weekly Content generation ─► Owner approval ─► Publish / Export
   │                                                      │
   ▼                                                      ▼
Facebook performance monitoring ─► Optional, provider-dependent AI optimization proposal ─► Owner approval
```

## 3. High-level architecture

MarketMind is a **TypeScript + Python monorepo** managed as npm workspaces
(`apps/*`, `services/*`, `packages/*`; see root `package.json`). There are four
deployable/shared units:

```
                         ┌───────────────────────────────────────────┐
        Browser  ─HTTPS─►│   Caddy (TLS, single public origin)        │
                         └───────┬───────────────────────┬───────────┘
                                 │ /,(everything else)    │ /api/* /internal/* /socket.io/*
                                 ▼                        ▼
                        ┌─────────────────┐      ┌─────────────────────┐
                        │  apps/web        │      │  apps/api            │
                        │  Next.js 16      │      │  NestJS 11           │
                        │  React 19, i18n  │      │  (orchestrator /     │
                        └─────────────────┘      │   system of record)  │
                                                 └───┬──────────┬───────┘
                                     sync HTTP        │          │  BullMQ / outbox
                              /internal/v1/ai/*       ▼          ▼
                                          ┌────────────────┐  ┌──────────────┐
                                          │  services/ai    │  │  Redis 7     │
                                          │  FastAPI        │  │  (queues)    │
                                          └───┬────────────┘  └──────────────┘
                                              │ vectors
                                     ┌────────▼────────┐   ┌────────────────┐
                                     │  Qdrant 1.18    │   │  PostgreSQL 16 │◄─ shared by
                                     │  (RAG vectors)  │   │  (Prisma +     │   api & ai
                                     └─────────────────┘   │   asyncpg)     │
                                                           └────────────────┘
```

| Unit | Tech | Role |
|---|---|---|
| `apps/api` | NestJS 11 (TypeScript) | Backend **orchestrator and system-of-record**. Owns auth, business data, queues, the Prisma schema, and all calls into the AI service. Entry `apps/api/src/main.ts`, wiring `apps/api/src/app.module.ts`. |
| `apps/web` | Next.js 16 / React 19 | Bilingual (AR/EN) frontend. App Router under `apps/web/src/app/[locale]` with `(auth)`, `(admin)`, `(landing)`, `(workspace)` route groups. |
| `services/ai` | FastAPI, Python 3.12 (uv) | AI service. Owns LLM calls, the RAG pipeline, Qdrant access, and the (gated) agentic orchestration engine. Entry `services/ai/app/main.py`. |
| `packages/contracts` | TypeScript **and** Python | The shared cross-language contract layer — request/response and domain types used by both NestJS and FastAPI. This is the API's type source of truth (there is no Swagger). |

## 4. Component responsibilities (API modules)

All modules below are registered in `apps/api/src/app.module.ts`.

| Module | Responsibility |
|---|---|
| `health` | DB + Redis + queue readiness probe |
| `auth` | Email/password + Google OAuth, JWT access tokens, HttpOnly rotating refresh cookies, email verify/reset |
| `rbac` | Roles/permissions guards and decorators |
| `users` | User entity |
| `discovery` | "Prepared Discovery" conversational business profiling; queue + real-time progress + AI calls (largest module) |
| `journey` | Owner's current-step state |
| `marketing-knowledge` | Governance of the reviewed marketing-knowledge corpus (owns its Postgres tables) |
| `strategy` | Marketing-strategy generation: brief → generate → versions/decisions |
| `content` | Content cycles/packs/items lifecycle, incl. a `v2/` subdomain (canonical per migrations) |
| `publishing` | Largest domain (13 submodules): intents, targets, candidates, dispatch, callbacks, exports, scheduling, meta, credentials, admin, assets, performance, common |
| `billing` | Bundles, wallet/points ledger, checkouts, provider webhooks; `fake`/`paymob` are supported and `geidea` is not implemented |
| `facebook` | Facebook OAuth connection + connection test/delete |
| `performance` | Facebook post metrics (overview/snapshots/refresh) + `optimization/` AI proposals |
| `admin` | Admin read views: users, revenue summary, subscriptions |
| `orchestration` | Persistence/contracts for LangGraph runs; gated — persistence-only; **no controller/route is wired** (see §10) |
| `redis`, `mail` | Redis client; nodemailer templated mail |
| `common/persistence` | `PrismaModule` / `PrismaService` |

## 5. Runtime data flows

**5.1 Web → API (synchronous HTTP, single origin).** The browser talks to the API over
HTTPS REST under `/api/v1`. The refresh-token cookie is HttpOnly, host-scoped, and
`SameSite=lax`, which forces web and API to **share one public origin** — Caddy routes
`/api/*`, `/internal/*`, and `/socket.io/*` to the API and everything else to the web
app (see `infra/caddy/Caddyfile` and `infra/docker/docker-compose.prod.yml`).

**5.2 API → AI service (synchronous HTTP).** NestJS calls the FastAPI service over
`@nestjs/axios` at `AI_SERVICE_BASE_URL` (`http://ai:8000` in the prod compose), hitting
the `POST /internal/v1/ai/*` routes. The AI service is an internal dependency — it is not
exposed publicly.

**5.3 Asynchronous work (Redis + BullMQ + transactional outbox).** Long-running work runs
on Redis-backed BullMQ queues — `discovery-research`, `strategy-generation`,
`content-generation`, `content-outbox`, `publishing-dispatch`, `facebook-performance`.
Reliability uses a **transactional-outbox** pattern with `@nestjs/schedule` `@Cron`
dispatchers for at-least-once delivery (content outbox ~every minute, content scheduler
~every 5 minutes, publishing reconciliation ~every 3 minutes, plus a performance
reconciler).

**5.4 Real-time progress.** Two mechanisms push generation progress to the browser:
`socket.io` gateways (`discovery-progress.gateway.ts`, `strategy-progress.gateway.ts`)
and a Server-Sent-Events stream on the discovery controller
(`@Sse(":sessionId/stream")`).

**5.5 Vector search.** Only the **AI service** talks to Qdrant
(`services/ai/app/qdrant/*`) for reviewed-knowledge RAG. The API never touches Qdrant
directly.

**5.6 Shared PostgreSQL.** Postgres is shared: the API owns the schema via Prisma; the
AI service reads/writes the marketing-knowledge tables directly via SQLAlchemy/asyncpg
(and, for the gated orchestration engine, a LangGraph Postgres checkpointer).

## 6. Cross-cutting concerns

- **Authentication:** JWT access tokens in the `Authorization` header; a rotating
  HttpOnly refresh cookie for silent refresh; Google OAuth with CSRF state cookie.
- **Authorization:** RBAC via `@Permissions(...)` + `PermissionsGuard`; endpoints declare
  required permissions (e.g. discovery uses `DISCOVERY_START`, `DISCOVERY_CONTINUE`,
  `DISCOVERY_CONFIRM_PROFILE`).
- **Human-in-the-loop:** owner approval is a first-class step in strategy, content, and
  optimization. No autonomous publishing.
- **Rate limiting / throttling:** `@nestjs/throttler` on auth and other sensitive routes;
  a per-client limiter middleware on the AI service.
- **Error model:** a single global `AllExceptionsFilter` maps to a stable
  `{ code, message }` shape (e.g. `RATE_LIMIT_EXCEEDED`, `OAUTH_STATE_MISMATCH`).
- **Validation:** a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `transform`) enforces DTOs.
- **Internationalization:** `next-intl` on the web app with AR/EN dictionaries and a
  CI dictionary-parity check.
- **Idempotency & signatures:** raw request body is preserved for billing-webhook HMAC
  verification; publishing dispatch/callbacks use signed, nonce-guarded payloads.

## 7. Deterministic guardrails around AI

A defining architectural decision: the LLM is **not trusted to invent business-critical
facts**. Channels, KPIs, and budgets come from a deterministic decision engine in the AI
service and are re-imposed on model output (the owner-first invariant — "the model can
never add, replace, or drop a channel"). This keeps AI output auditable and within the
owner's control. Detail in [Document 3 §2](./03_AI_RAG_AGENTIC_TECHNICAL_DOCUMENT.md).

## 8. Technology choices & rationale (verified stack)

This section supersedes the older, thinner `Docs/techstack.md`.

| Layer | Choice | Why |
|---|---|---|
| API | **NestJS 11** + TypeScript ~5.7 | Structured DI/modules fit a multi-domain orchestrator; first-class guards, pipes, schedules, and queue integration. |
| ORM / DB | **Prisma 6** + **PostgreSQL 16** | Type-safe schema + migrations shared with contracts; relational integrity for a rich domain (87 models). |
| Queues | **BullMQ 5** on **Redis 7** | Durable async jobs (research, strategy, content, publishing) with retries; pairs with the transactional-outbox pattern. |
| Real-time | **socket.io 4** + SSE | Push generation progress to the owner during long AI runs. |
| Web | **Next.js 16 / React 19**, next-intl 4, Tailwind v4 | App Router + i18n for a bilingual AR/EN product; single-origin proxy to the API. |
| AI service | **FastAPI** + Python 3.12 (uv) | Python ecosystem for LLM/RAG/agent libraries; async HTTP surface for the API to call. |
| Vector DB | **Qdrant 1.18** | Reviewed-knowledge retrieval with payload filtering and compatibility fingerprints. |
| Agentic | **LangGraph 1.2** + Postgres checkpointer | Durable, resumable agent graphs with human-approval interrupts. |
| Contracts | shared **TS + Python** package | One source of truth across the language boundary; substitutes for OpenAPI. |
| Object storage | Cloudflare **R2** (S3 API) | Content media assets in production. |

## 9. Version control & delivery (summary)

Git with a `main` default branch and feature branches; conventions in
`Docs/planning/07_GIT_CONVENTIONS.md`. API, web, and AI workflows run on matching pull
requests and pushes to `main`; the image workflow runs on `main` pushes or manual dispatch.
At the time of writing, the repository has no branch-protection rule, so these workflows
are available checks rather than enforced merge gates. Full CI/CD detail is in
[Document 2 §8–9](./02_API_DATABASE_AND_DEPLOYMENT_GUIDE.md).

## 10. Implemented vs shadow/planned — architecture ledger

| Capability | Status | Note |
|---|---|---|
| Auth + RBAC, discovery, strategy, content v1+v2, performance, publishing intents/targets/exports, health | implemented | On the live path. Optimization proposals are provider-dependent; `gemini_dev` does not provide them. |
| Transactional outbox + cron reconciliation, BullMQ queues, socket.io/SSE progress | implemented | |
| **LangGraph agentic orchestration** (`services/ai/app/orchestration/`) | implemented, not on the live path | Code complete (phases 0-5). The code default is `AI_ORCHESTRATION_ENABLED=false` and hosted Compose overrides it to `true`, but no FastAPI orchestration router or NestJS controller invokes the graph, so current product paths do not use it. See Doc 3 section 6. |
| Billing `geidea` provider | not implemented | Explicitly not implemented; prod runs `fake`. |
| n8n automated publishing | simulated | Demo-inert; manual/simulated flow only (Doc 2 §9). |

## 11. Source map (where to look)

- Wiring & global config: `apps/api/src/app.module.ts`, `apps/api/src/main.ts`
- Data model: `apps/api/prisma/schema.prisma`
- AI routers: `services/ai/app/main.py`, `services/ai/app/api/internal_v1/`
- Contracts (API type source of truth): `packages/contracts/`
- Deployment topology: `infra/docker/docker-compose.prod.yml`, `infra/caddy/Caddyfile`, `DEPLOY_HOSTED.md`
- Product framing: `Docs/planning/00_START_HERE.md`, `02_MARKETMIND_AI_FLOW.md`, `03_AGENTS_OVERVIEW.md`
