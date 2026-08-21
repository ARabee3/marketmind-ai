# MarketMind API

NestJS 11 backend for MarketMind AI. The API owns authentication, business
authorization, durable lifecycle state, approvals, billing, queues,
publishing, provider connections, performance collection, and admin controls.

## Run locally

The recommended full-stack path is from the monorepo root:

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:full
```

To run only the API after local dependencies and migrations are ready:

```bash
npm run start:dev -w @marketmind/api
```

The API is available at <http://localhost:3001/api/v1>. Verify it with:

```bash
curl http://localhost:3001/api/v1/health
```

## Main modules

| Module                            | Responsibility                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `auth`, `users`, `rbac`, `admin`  | Identity, rotating sessions, roles, permissions, and administration                  |
| `discovery`, `journey`            | Business intake, research-backed interviews, confirmation, and journey state         |
| `strategy`, `marketing-knowledge` | Strategy lifecycle, reviewed knowledge governance, retrieval inputs, and approvals   |
| `content`                         | Content V1/V2 planning, jobs, generation handoff, revisions, assets, and decisions   |
| `publishing`, `facebook`          | Immutable candidates, scheduling, export/simulation, Meta connections, and execution |
| `performance`                     | Eligible Facebook snapshot windows, sync state, and Optimization decisions           |
| `billing`                         | Points wallet, catalog, checkout, ledger, outbox, and provider callbacks             |
| `mail`, `audit`, `orchestration`  | Transactional email, audit records, and feature-gated orchestration boundary         |

## Data and execution

- PostgreSQL/Prisma is the durable source of truth.
- Redis/BullMQ carries recoverable jobs and schedules.
- FastAPI is an internal AI capability service; it does not own product
  lifecycle rows.
- Qdrant is a rebuildable index of approved shared marketing knowledge.
- Content approval and publication approval are separate immutable decisions.

The current Prisma schema and migrations live under `prisma/`. Apply committed
migrations with:

```bash
npm run prisma:migrate:deploy -w @marketmind/api
```

## Checks

```bash
npm run build -w @marketmind/api
npm run test -w @marketmind/api
npm run test:e2e -w @marketmind/api
```

Database-focused tests use the dedicated `test/jest-db.json` configuration and
must point only to a disposable test database.

See the [API, database, and deployment guide](../../Docs/technical-and-ai-docs/02_API_DATABASE_AND_DEPLOYMENT_GUIDE.md)
for the complete endpoint and operational reference.
