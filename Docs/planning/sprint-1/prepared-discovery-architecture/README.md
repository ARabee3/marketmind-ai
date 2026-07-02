# Prepared Discovery Feature Architecture

This folder explains the initial Prepared Discovery feature architecture before coding starts.

Prepared Discovery is the first full owner journey: the owner submits intake details and optional public links, the system prepares bounded public context, then the Discovery Agent runs a focused interview and produces a profile draft for owner confirmation.

Read in this order:

1. `01_SYSTEM_ARCHITECTURE_AND_CONTRACTS.md`
2. `02_DATABASE_SCHEMA_AND_MIGRATIONS.md`
3. `03_RUNTIME_QUALITY_AND_OPERATIONS.md`
4. `04_AI_I18N_AND_DOC_GOVERNANCE.md`
5. `../DISCOVERY_IMPLEMENTATION_HANDOFF.md` for the implemented flow, review
   guide, verification evidence, and remaining production checks.

Project-wide structure lives outside this feature pack:

- `Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md`

Scope:

- Explains the Prepared Discovery feature, system boundaries, database model, runtime behavior, AI behavior, and operating expectations.
- Defines the system architecture, API boundaries, database schema, relations, indexes, migrations, errors, testing, deployment, secrets, observability, i18n, and non-functional requirements for the first version.
- Ignores frontend documentation for now, except where backend contracts must support a future frontend.

Authoritative decisions:

- NestJS is the public API, auth, RBAC, WebSocket, orchestration, and PostgreSQL owner.
- FastAPI is the internal AI service for provider calls, prompt execution, and AI response shaping.
- PostgreSQL is the source of truth.
- Qdrant is a future derived vector index, not required for Sprint 1.
- Prepared Discovery research must run before chat opens, but total research failure must not block the user from continuing.
- WebSocket is progress-only. HTTP status is the recovery source of truth.
- No frontend architecture is defined in this file.

## Documentation Map

| Topic | Document |
|---|---|
| System architecture, service ownership, API routes, and versioning | `01_SYSTEM_ARCHITECTURE_AND_CONTRACTS.md` |
| PostgreSQL tables, relations, indexes, and migration order | `02_DATABASE_SCHEMA_AND_MIGRATIONS.md` |
| Error handling, testing, deployment, secrets, observability, and non-functional requirements | `03_RUNTIME_QUALITY_AND_OPERATIONS.md` |
| AI provider policy, bilingual behavior, and documentation change rules | `04_AI_I18N_AND_DOC_GOVERNANCE.md` |
| Implemented behavior, review guide, and sufficiency boundary | `../DISCOVERY_IMPLEMENTATION_HANDOFF.md` |
| Project folder structure and reusable components | `Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md` |
