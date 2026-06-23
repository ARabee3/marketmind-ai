# Sprint 1 Vertical Slice — Real Discovery AI + NestJS Auth/RBAC

This sprint is implementation work, not planning-only work.

Each card owner is responsible for thinking, building, testing, documenting the important decisions, and explaining the result in review.

## Sprint 1 goal

Prepare the foundation for the first real AI agent: the Discovery Agent.

By the end of Sprint 1, the team should have:

- NestJS backend initialized.
- Auth APIs working.
- Basic RBAC working.
- Simple health endpoint working.
- Real AI Discovery Agent foundation started.
- Clear contract between NestJS and the AI service.
- Test cases for both streams.
- No premature `AuditModule`.

## Team split

| Member | Owns and implements | Reviews |
|---|---|---|
| Ahmed | Discovery Agent flow + AI/Nest contract | Mokhtar’s Auth APIs |
| Merzek | Real AI provider adapter + Discovery prompt behavior | Gerges’s RBAC guards |
| Kordy | Discovery schemas + AI test/evaluation cases | Abdulazim’s NestJS setup |
| Abdulazim | NestJS repo initialization + `HealthModule` | Kordy’s schemas/tests |
| Mokhtar | Auth APIs | Ahmed’s AI/Nest contract |
| Gerges | RBAC roles, permissions, and guards | Merzek’s AI provider/prompt behavior |

Ahmed and Merzek review AI-critical decisions.

Auth, RBAC, prompts, schemas, and provider calls need careful review because they affect the whole project.

## Backend modules for Sprint 1

Create only these NestJS modules:

```text
AuthModule
UsersModule
RbacModule
HealthModule
```

Do not create:

```text
AuditModule
```

## Why keep HealthModule?

`HealthModule` is small but useful.

For Sprint 1, it should only expose:

```text
GET /health
```

Later, it can check:

- database connection
- Redis or BullMQ
- AI service availability
- Qdrant availability

For now, a simple healthy response is enough.

## Why defer AuditModule?

Audit matters, but it becomes useful when the system has approval-sensitive actions.

Examples:

- profile confirmation
- strategy approval
- publishing approval
- optimization approval
- AI decision traces

Since Sprint 1 focuses on Auth/RBAC and the real Discovery AI foundation, a full audit module now would be premature.

For now, keep this future rule:

> Important owner approvals and AI-sensitive actions must create audit events later.

## Slice 1 — Ahmed: Discovery Agent flow + AI/Nest contract

Build and document:

- Discovery session lifecycle:
  - start
  - continue interview
  - produce profile draft
  - request confirmation
- contract between NestJS and the AI service
- completion rules
- forbidden Discovery behavior

Minimum AI service endpoints to design:

```text
POST /ai/discovery/start
POST /ai/discovery/respond
POST /ai/discovery/summarize
```

Acceptance:

- NestJS team can understand how to call the AI service later.
- The AI service receives structured input and returns structured output.
- Discovery does not perform strategy or content work.

## Slice 2 — Merzek: Real AI provider adapter + prompt behavior

Build and document:

- real OpenAI-first provider adapter
- Discovery Agent prompt skeleton
- structured response expectations
- provider error behavior
- basic tracing/logging approach

Acceptance:

- Real AI call path is ready.
- Prompt supports Arabic, English, and mixed language.
- Prompt tells the AI not to invent facts.
- AI returns either the next question or a profile draft in a structured shape.

## Slice 3 — Kordy: Discovery schemas + AI test cases

Build and document:

- `DiscoverySession`
- `DiscoveryMessage`
- `BusinessProfileDraft`
- `BusinessProfile`
- `Uncertainty`
- `AgentRun`
- AI evaluation cases

Acceptance:

- Schemas are usable by both AI and NestJS streams.
- Test cases cover Arabic, English, mixed language, unknowns, contradiction, resume, and prompt injection.
- Outputs can be validated.

## Slice 4 — Abdulazim: NestJS repo initialization + HealthModule

Build:

- NestJS project structure
- environment config structure
- `HealthModule`
- basic module layout:
  - `AuthModule`
  - `UsersModule`
  - `RbacModule`
  - `HealthModule`

Acceptance:

- Backend runs locally.
- `GET /health` returns a simple healthy response.
- Other backend members can start auth/RBAC work without setup confusion.
- No `AuditModule` is created in Sprint 1.

## Slice 5 — Mokhtar: Auth APIs

Build:

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET /auth/me
```

Acceptance:

- User can register as owner.
- Duplicate email is rejected.
- Password is hashed.
- Login returns tokens.
- Refresh works.
- Logout invalidates refresh session.
- `/auth/me` requires authentication.

## Slice 6 — Gerges: RBAC roles, permissions, and guards

Build:

- role and permission model
- guards/decorators for protected endpoints
- current-user permission resolution

Initial roles:

```text
owner
admin
developer_demo
```

Initial permissions:

```text
business:read
business:update
discovery:start
discovery:continue
discovery:confirm_profile
strategy:start
admin:manage_library
```

Acceptance:

- Protected routes can require permissions.
- Owner permissions are returned correctly.
- Unauthorized access is rejected.
- RBAC is ready to protect Discovery APIs later.

## Cross-review rules

The reviewer must understand enough to explain the work.

Every review checks:

- correctness
- security
- integration with the other stream
- test evidence
- documentation impact

Sensitive work needs two approvals:

- auth
- RBAC
- AI prompts
- schemas
- provider calls
- confirmation and approval logic

## Sprint 1 test scenarios

AI side:

- Arabic interview.
- English interview.
- Mixed Arabic/English interview.
- Unknown answer.
- Contradictory answer.
- User asks for strategy during Discovery.
- Prompt-injection style user message.
- Provider failure.

Backend side:

- Register success.
- Duplicate email failure.
- Login success.
- Wrong password failure.
- Refresh token success.
- Logout invalidates session.
- `/auth/me` protected.
- Permission guard allows valid permission.
- Permission guard rejects missing permission.

## Trello import note

Trello is not connected in this workspace.

Use `trello_sprint_1_cards.csv` in this folder as the card source for manual import or copy-paste.
