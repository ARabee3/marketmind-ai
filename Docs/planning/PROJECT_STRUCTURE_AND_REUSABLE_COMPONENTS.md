# Project Structure and Reusable Components

This file defines the target folder structure for implementation.

Goal:

- Keep the monorepo easy to navigate.
- Separate deployable apps from shared packages.
- Keep reusable code in stable places.
- Avoid premature packages for code used only once.

## Structure Rules

Use this rule before creating a folder:

1. If code belongs to one deployable app, keep it inside that app.
2. If code is shared by NestJS, FastAPI, and the future frontend as a contract, put it in `packages/contracts`.
3. If code is shared only inside one app, put it in that app's `common` or feature module folder.
4. If code is infrastructure or deployment, put it in `infra`.
5. Do not create a new package until two real consumers need it.

## Target Monorepo Layout

```text
marketmind-ai/
├── Docs/
│   └── planning/
│       ├── PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md
│       └── sprint-1/
│           ├── 07_SPRINT_1_VERTICAL_SLICE.md
│           ├── github_project_manual_setup.md
│           ├── github_sprint_1_issue_packets.md
│           └── prepared-discovery-architecture/
│               ├── README.md
│               ├── 01_SYSTEM_ARCHITECTURE_AND_CONTRACTS.md
│               ├── 02_DATABASE_SCHEMA_AND_MIGRATIONS.md
│               ├── 03_RUNTIME_QUALITY_AND_OPERATIONS.md
│               └── 04_AI_I18N_AND_DOC_GOVERNANCE.md
├── apps/
│   ├── api/
│   └── web/
├── services/
│   └── ai/
├── packages/
│   └── contracts/
├── infra/
├── package.json
└── README.md
```

Sprint 1 should build inside this existing shape. Do not add more top-level folders unless there is a concrete owner and runtime reason.

## `apps/api` NestJS Structure

`apps/api` is the public backend and the only PostgreSQL writer in Sprint 1.

```text
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── env.schema.ts
│   │   └── configuration.ts
│   ├── common/
│   │   ├── errors/
│   │   │   ├── app-error.ts
│   │   │   ├── error-codes.ts
│   │   │   └── http-exception.filter.ts
│   │   ├── logging/
│   │   │   └── request-id.middleware.ts
│   │   ├── persistence/
│   │   │   └── prisma.service.ts
│   │   ├── security/
│   │   │   ├── current-user.decorator.ts
│   │   │   └── ownership.ts
│   │   └── validation/
│   │       └── validation.pipe.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── password.service.ts
│   │   │   ├── token.service.ts
│   │   │   └── dto/
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.repository.ts
│   │   │   └── users.service.ts
│   │   ├── rbac/
│   │   │   ├── rbac.module.ts
│   │   │   ├── permissions.decorator.ts
│   │   │   ├── permissions.guard.ts
│   │   │   └── rbac.service.ts
│   │   ├── health/
│   │   │   ├── health.controller.ts
│   │   │   └── health.module.ts
│   │   └── discovery/
│   │       ├── discovery.controller.ts
│   │       ├── discovery.module.ts
│   │       ├── discovery.service.ts
│   │       ├── discovery.repository.ts
│   │       ├── discovery-state.ts
│   │       ├── dto/
│   │       ├── intelligence/
│   │       │   ├── intelligence-gatherer.service.ts
│   │       │   ├── metadata-extractor.service.ts
│   │       │   ├── search-client.service.ts
│   │       │   └── match-filter.ts
│   │       ├── ai-client/
│   │       │   ├── ai-discovery.client.ts
│   │       │   └── ai-error.mapper.ts
│   │       └── progress/
│   │           ├── discovery-progress.gateway.ts
│   │           └── discovery-progress.service.ts
│   └── test/
│       ├── fixtures/
│       └── e2e/
├── .env.example
└── package.json
```

### NestJS Folder Responsibilities

| Folder | Responsibility |
|---|---|
| `src/config` | Environment parsing and typed config. |
| `src/common/errors` | Shared error envelope and exception mapping. |
| `src/common/logging` | Request id and structured logging setup. |
| `src/common/persistence` | Prisma service and DB transaction helpers. |
| `src/common/security` | Current-user decorator, ownership helpers, auth guard helpers. |
| `src/modules/auth` | Registration, login, refresh, logout, `/me`. |
| `src/modules/users` | User persistence and lookup. |
| `src/modules/rbac` | Roles, permissions, guards, decorators. |
| `src/modules/health` | `/api/v1/health`. |
| `src/modules/discovery` | Prepared Discovery orchestration and API. |
| `src/modules/discovery/intelligence` | Internal `IntelligenceGatherer`, metadata extraction, free/no-key search, match filtering. |
| `src/modules/discovery/ai-client` | Calls from NestJS to FastAPI. |
| `src/modules/discovery/progress` | WebSocket progress and persisted progress event replay. |

Do not create `AuditModule` in Sprint 1.

## `services/ai` FastAPI Structure

`services/ai` is the internal AI runtime. It does not own PostgreSQL migrations in Sprint 1.

```text
services/ai/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── errors.py
│   │   └── logging.py
│   ├── api/
│   │   ├── health.py
│   │   └── internal_v1/
│   │       └── discovery.py
│   ├── discovery/
│   │   ├── service.py
│   │   ├── prompts.py
│   │   ├── prompt_versions.py
│   │   ├── schemas.py
│   │   └── validators.py
│   ├── providers/
│   │   ├── base.py
│   │   ├── mock_provider.py
│   │   ├── openai_provider.py
│   │   └── gemini_provider.py
│   └── tests/
│       ├── fixtures/
│       └── test_discovery_contract.py
├── .env.example
└── pyproject.toml
```

### FastAPI Folder Responsibilities

| Folder | Responsibility |
|---|---|
| `app/core` | Settings, error envelope, request id logging. |
| `app/api/internal_v1` | Internal HTTP routes called by NestJS only. |
| `app/discovery` | Discovery prompt, service flow, Pydantic schemas, validation. |
| `app/providers` | Provider-neutral adapter plus `mock`, `openai`, and `gemini_dev` implementations. |
| `app/tests` | Provider, schema, prompt-boundary, and contract tests. |

Provider code must not leak into `app/discovery/service.py`. The service calls `Provider.generate_structured(...)` or equivalent through one adapter interface.

## `packages/contracts` Structure

`packages/contracts` holds shared contracts, not business logic.

```text
packages/contracts/
├── src/
│   ├── discovery/
│   │   ├── discovery-session.schema.ts
│   │   ├── prepared-discovery-intake.schema.ts
│   │   ├── intelligence-result.schema.ts
│   │   ├── business-profile-draft.schema.ts
│   │   └── index.ts
│   ├── errors/
│   │   ├── error-envelope.schema.ts
│   │   └── error-codes.ts
│   ├── auth/
│   │   └── auth-contracts.ts
│   └── index.ts
├── examples/
│   ├── discovery-start.request.json
│   ├── discovery-status.response.json
│   ├── discovery-profile-draft.response.json
│   └── error-envelope.response.json
└── package.json
```

Allowed here:

- Contract schemas.
- Shared TypeScript types generated from schemas.
- Example JSON fixtures.
- Error code constants.

Not allowed here:

- NestJS controllers/services.
- FastAPI provider logic.
- Database repositories.
- Business workflow logic.
- Secrets or environment-specific config.

Python cannot directly consume TypeScript types. For Sprint 1, keep FastAPI Pydantic models in `services/ai/app/discovery/schemas.py` and verify them against the JSON examples in `packages/contracts/examples`.

## `apps/web` Structure

Frontend documentation is deferred, but the repo should still leave a clean future home:

```text
apps/web/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   └── discovery/
│   ├── lib/
│   └── styles/
└── package.json
```

Do not spend Sprint 1 backend/AI time designing the full frontend component tree. Only keep API contracts frontend-friendly.

## `infra` Structure

```text
infra/
├── docker/
│   ├── docker-compose.local.yml
│   └── postgres/
│       └── init/
├── env/
│   ├── api.env.example
│   └── ai.env.example
└── README.md
```

Sprint 1 infra should support local development only:

- PostgreSQL container.
- Optional Qdrant container, unused by default.
- No Terraform.
- No production cloud IaC.

## Reusable Component Boundaries

### Reusable Now

Create these because two or more parts need them immediately:

- Error envelope shape in `packages/contracts/src/errors`.
- Discovery contract examples in `packages/contracts/examples`.
- Request id/error mapping in `apps/api/src/common`.
- Provider adapter interface in `services/ai/app/providers/base.py`.

### Keep App-Local for Now

Do not extract these into packages yet:

- `IntelligenceGatherer`
- metadata extraction
- free/no-key search client
- Prisma repositories
- RBAC guards
- FastAPI prompt templates
- WebSocket progress service

Reason: each has one real runtime owner in Sprint 1.

### Future Extraction Candidates

Extract later only when there is a second real consumer:

- shared TypeScript config package
- shared UI component package
- shared logging package
- generated OpenAPI/JSON Schema package consumed by both frontend and backend
- reusable research/search provider package

## Dependency Direction

Allowed dependencies:

```text
apps/api -> packages/contracts
apps/web -> packages/contracts
services/ai -> packages/contracts/examples only, or generated language-neutral schemas later
infra -> apps/api and services/ai runtime commands
```

Forbidden dependencies:

```text
packages/contracts -> apps/*
packages/contracts -> services/*
apps/api -> services/ai source code
services/ai -> apps/api source code
apps/web -> services/ai directly
```

NestJS talks to FastAPI over HTTP. It must not import FastAPI source files.

## Sprint 1 Minimum Creation Order

1. Create `apps/api/src/common`, `src/config`, and the four backend foundation modules.
2. Add Prisma under `apps/api/prisma`.
3. Create `packages/contracts` schemas/examples for Discovery and errors.
4. Create `services/ai/app/core`, `app/api/internal_v1`, `app/discovery`, and `app/providers`.
5. Add Discovery module folders in `apps/api/src/modules/discovery`.
6. Add `infra/docker/docker-compose.local.yml` after the API needs PostgreSQL locally.

Do not create empty future modules just to reserve names.
