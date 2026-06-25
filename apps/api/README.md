# MarketMind API

NestJS backend API for MarketMind AI.

## Prerequisites

- Node.js >= 20
- npm >= 10
- Docker (for local PostgreSQL)

## Quick Start

### 1. Install dependencies

From the **monorepo root**:

```bash
npm install
```

### 2. Set up environment

```bash
cp apps/api/.env.example apps/api/.env
```

### 3. Start PostgreSQL

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
```

### 4. Generate Prisma client

```bash
cd apps/api
npx prisma generate
```

### 5. Run migrations (once models are defined)

```bash
cd apps/api
npx prisma migrate dev
```

### 6. Start the API

```bash
cd apps/api
npm run start:dev
```

The API will be available at `http://localhost:3000/api/v1`.

### 7. Verify

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-06-25T08:00:00.000Z",
  "service": "marketmind-api"
}
```

## Scripts

| Script | Description |
|---|---|
| `npm run start:dev` | Start in watch mode |
| `npm run start:debug` | Start in debug + watch mode |
| `npm run build` | Build for production |
| `npm run start:prod` | Run production build |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run e2e tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate:dev` | Run migrations (dev) |
| `npm run prisma:studio` | Open Prisma Studio |

## Project Structure

```
apps/api/
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # Database migrations
│   └── seed.ts                # Seed script
├── src/
│   ├── main.ts                # Application entry point
│   ├── app.module.ts          # Root module
│   ├── config/
│   │   ├── configuration.ts   # Typed config factory
│   │   └── env.schema.ts      # Env validation
│   ├── common/
│   │   └── persistence/
│   │       ├── prisma.module.ts
│   │       └── prisma.service.ts
│   └── modules/
│       ├── auth/              # Auth (Issue #5)
│       ├── users/             # Users (Issue #5)
│       ├── rbac/              # RBAC (Issue #6)
│       └── health/            # Health endpoint
├── test/
│   └── health.e2e-spec.ts     # E2e tests
├── .env.example
├── nest-cli.json
├── package.json
└── tsconfig.json
```

## Database

- **Engine**: PostgreSQL 16
- **ORM/Migration**: Prisma
- **Direction**: PostgreSQL is the source of truth. Qdrant is reserved for later RAG/vector retrieval.

See `Docs/planning/sprint-1/prepared-discovery-architecture/02_DATABASE_SCHEMA_AND_MIGRATIONS.md` for the full Sprint 1 schema.
