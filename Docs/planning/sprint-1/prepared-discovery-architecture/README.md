# Prepared Discovery Architecture Pack

This folder splits the Sprint 1 Prepared Discovery architecture plan into grouped files.

Read in this order:

1. `01_SYSTEM_ARCHITECTURE_AND_CONTRACTS.md`
2. `02_DATABASE_SCHEMA_AND_MIGRATIONS.md`
3. `03_RUNTIME_QUALITY_AND_OPERATIONS.md`
4. `04_AI_I18N_AND_DOC_GOVERNANCE.md`

Project-wide structure lives outside this feature pack:

- `Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md`

Scope:

- Covers the non-frontend gaps raised for Prepared Discovery.
- Defines the system architecture, API boundaries, database schema, relations, indexes, migrations, errors, testing, deployment, secrets, observability, i18n, and non-functional requirements.
- Ignores frontend documentation for now, except where backend contracts must support a future frontend.

Authoritative decisions:

- NestJS is the public API, auth, RBAC, WebSocket, orchestration, and PostgreSQL owner.
- FastAPI is the internal AI service for provider calls, prompt execution, and AI response shaping.
- PostgreSQL is the source of truth.
- Qdrant is a future derived vector index, not required for Sprint 1.
- Prepared Discovery research must run before chat opens, but total research failure must not block the user from continuing.
- WebSocket is progress-only. HTTP status is the recovery source of truth.
- No frontend architecture is defined in this file.

## Gap Coverage

| Gap | Covered by |
|---|---|
| G1 System architecture diagram | `01_SYSTEM_ARCHITECTURE_AND_CONTRACTS.md` |
| G2 Database schema | `02_DATABASE_SCHEMA_AND_MIGRATIONS.md` |
| G3 Error handling strategy | `03_RUNTIME_QUALITY_AND_OPERATIONS.md` |
| G4 Testing strategy | `03_RUNTIME_QUALITY_AND_OPERATIONS.md` |
| G5 Deployment/environment plan | `03_RUNTIME_QUALITY_AND_OPERATIONS.md` |
| G6 Frontend documentation | Explicitly deferred by user request |
| G7 AI model selection rationale | `04_AI_I18N_AND_DOC_GOVERNANCE.md` |
| G8 Secret management pattern | `03_RUNTIME_QUALITY_AND_OPERATIONS.md` |
| G9 API versioning | `01_SYSTEM_ARCHITECTURE_AND_CONTRACTS.md` |
| G10 Monitoring/observability | `03_RUNTIME_QUALITY_AND_OPERATIONS.md` |
| G11 i18n architecture | `04_AI_I18N_AND_DOC_GOVERNANCE.md` |
| G12 Doc change management | `04_AI_I18N_AND_DOC_GOVERNANCE.md` |
| G13 Non-functional requirements | `03_RUNTIME_QUALITY_AND_OPERATIONS.md` |
| Project folder structure and reusable components | `Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md` |
