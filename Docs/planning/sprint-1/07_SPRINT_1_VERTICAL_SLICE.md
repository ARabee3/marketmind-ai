# Sprint 1 Vertical Slice — Prepared Discovery + NestJS Auth/RBAC

This sprint is implementation work, not planning-only work.

Each issue owner is responsible for thinking, building, testing, documenting the important decisions, and explaining the result in review.

## Sprint 1 goal

Implement the first full Prepared Discovery journey.

Prepared Discovery means the owner submits intake information and optional public social links, the system performs bounded pre-chat intelligence gathering, shows WebSocket research progress, then opens a focused Discovery interview that produces a structured `BusinessProfileDraft` for owner confirmation.

By the end of Sprint 1, the team should have:

- NestJS backend initialized.
- Auth APIs working.
- Basic RBAC working.
- Simple health endpoint working.
- Prepared Discovery flow working end-to-end.
- `IntelligenceGatherer` internal helper for pre-chat research.
- Lightweight metadata extraction for owner-provided links.
- Free/no-key search for bounded market and competitor context.
- WebSocket progress for the research/loading experience.
- Clear contract between NestJS and the AI service.
- Test cases for both streams.
- No premature `AuditModule`.

## Team split

| Member    | Owns and implements                                   | Reviews                              |
| --------- | ----------------------------------------------------- | ------------------------------------ |
| Ahmed     | Prepared Discovery flow + AI/Nest/WebSocket contract  | Mokhtar’s Auth APIs                  |
| Merzek    | Real AI provider adapter + Discovery prompt behavior  | Gerges’s RBAC guards                 |
| Kordy     | Prepared Discovery schemas + AI test/evaluation cases | Abdulazim’s NestJS setup             |
| Abdulazim | NestJS repo initialization + `HealthModule`           | Kordy’s schemas/tests                |
| Mokhtar   | Auth APIs                                             | Ahmed’s AI/Nest contract             |
| Gerges    | RBAC roles, permissions, and guards                   | Merzek’s AI provider/prompt behavior |

Ahmed and Merzek review AI-critical decisions.

Auth, RBAC, prompts, schemas, and provider calls need careful review because they affect the whole project.

## Backend modules for Sprint 1

Create these backend foundation modules first:

```text
AuthModule
UsersModule
RbacModule
HealthModule
```

Prepared Discovery also needs:

```text
DiscoveryModule
```

Do not create:

```text
AuditModule
```

## Why keep HealthModule?

`HealthModule` is small but useful.

For Sprint 1, it should only expose:

```text
GET /api/v1/health
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

Since Sprint 1 focuses on Auth/RBAC and the Prepared Discovery journey, a full audit module now would be premature.

For now, keep this future rule:

> Important owner approvals and AI-sensitive actions must create audit events later.

## Prepared Discovery decisions

Sprint 1 follows the decisions recorded in:

```text
Docs/planning/sprint-1/prepared-discovery-architecture/README.md
Docs/planning/sprint-1/intelligence-gatherer-integration-fix-plan.md
Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md
```

Approved direction:

- Public API boundary is NestJS.
- Public routes use `/api/v1`, WebSocket routes use `/ws/v1`, and internal AI routes use `/internal/v1`.
- Internal AI work runs in FastAPI.
- Project folders follow `Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md`.
- PostgreSQL is the source of truth.
- Qdrant is reserved for later RAG/vector retrieval.
- `IntelligenceGatherer` is an internal helper inside Discovery, not the future standalone Research Agent.
- Owner-provided social links are optional but become the primary lookup target when present.
- Lightweight page metadata extraction runs first.
- Free/no-key search gathers bounded market and competitor context.
- WebSocket progress is required for the prepared-consultant UX.
- Research must happen before Discovery chat opens. No form-only Discovery as the normal path.
- Research facts visible to the owner need source labels/citations.
- Wrong or low-confidence matches are discarded before they reach the agent.
- AI output must be schema-validated structured output.
- Discovery asks questions and summarizes only; it does not create strategy, content, channel recommendations, or budget allocation.

## Slice 1 — Ahmed: Prepared Discovery flow + AI/Nest/WebSocket contract

Build and document:

- Prepared Discovery lifecycle:
  - start intake
  - run pre-chat intelligence gathering
  - stream WebSocket progress
  - open Discovery chat
  - continue interview
  - produce profile draft
  - request owner confirmation
- public NestJS contract
- internal FastAPI contract
- WebSocket progress contract
- completion, partial, and failure rules
- forbidden Discovery behavior

Minimum AI service endpoints to design:

```text
POST /internal/v1/ai/discovery/start
POST /internal/v1/ai/discovery/respond
POST /internal/v1/ai/discovery/summarize
```

Public NestJS endpoints to design:

```text
POST /api/v1/discovery/start
GET /api/v1/discovery/:session_id/status
POST /api/v1/discovery/:session_id/respond
POST /api/v1/discovery/:session_id/summarize
POST /api/v1/discovery/:session_id/confirm-profile
WS /ws/v1/discovery
```

After connecting, the client emits `discovery.join` with the target
`session_id`.

Acceptance:

- NestJS team can understand how to call the AI service.
- Frontend team can understand how to start the flow and receive progress.
- The AI service receives structured input and returns structured output.
- Research status is recoverable through HTTP status if WebSocket disconnects.
- Owner confirmation boundary is clear.
- Discovery does not perform strategy or content work.

## Slice 2 — Merzek: Real AI provider adapter + prompt behavior

Build and document:

- OpenAI-intended provider adapter
- Gemini/free dev provider mode
- deterministic mock/no-key mode for local development and tests
- Discovery Agent prompt skeleton
- structured response expectations
- provider error behavior
- basic tracing/logging approach

Acceptance:

- Provider adapter supports `openai`, `gemini_dev`, and `mock` modes.
- Local development does not block when `OPENAI_API_KEY` is missing.
- Prompt supports Arabic, English, and mixed language.
- Prompt tells the AI not to invent facts.
- Prompt forbids strategy, content, channel, and budget recommendations.
- AI returns either the next question or a profile draft in a structured shape.
- Invalid model output is rejected or retried safely.

## Slice 3 — Kordy: Prepared Discovery schemas + AI test cases

Build and document:

- `DiscoverySession`
- `DiscoveryMessage`
- `PreparedDiscoveryIntake`
- `SocialLink`
- `IntelligenceResult`
- `ResearchObservation`
- `SourceRef`
- `ConversationHook`
- `KnowledgeGap`
- `BusinessProfileDraft`
- `BusinessProfile`
- `Uncertainty`
- `AgentRun`
- AI evaluation cases

Acceptance:

- Schemas are usable by both AI and NestJS streams.
- Schemas separate confirmed owner facts, research observations, uncertainties, owner goals, and strategy-relevant notes.
- Source labels/citations can be stored for owner-visible research facts.
- Test cases cover Arabic, English, mixed language, unknowns, contradiction, resume, and prompt injection.
- Test cases cover metadata extraction, free/no-key search partial failure, wrong-match discard, strategy request refusal, and profile confirmation lock.
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
- `GET /api/v1/health` returns a simple healthy response.
- Other backend members can start auth/RBAC work without setup confusion.
- No `AuditModule` is created in Sprint 1.

## Slice 5 — Mokhtar: Auth APIs

Build:

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET /api/v1/auth/me
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

- Owner submits social links and metadata extraction contributes observations.
- Owner submits no social links and bounded free/no-key search still runs.
- WebSocket emits research progress stages.
- Research partially fails and chat opens with `partial_ready`.
- Total research failure is labeled `research_failed`.
- Wrong/low-confidence business match is discarded.
- Arabic interview.
- English interview.
- Mixed Arabic/English interview.
- Unknown answer.
- Contradictory answer.
- User asks for strategy during Discovery.
- Prompt-injection style user message.
- Provider failure.
- Schema-invalid AI output.
- Profile draft separates confirmed facts, research observations, uncertainties, owner goals, and strategy notes.

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
- Discovery start requires `discovery:start`.
- Discovery respond/summarize requires `discovery:continue`.
- Profile confirmation requires `discovery:confirm_profile`.

## Sprint 1 done definition

Sprint 1 is done when the team can demo one Prepared Discovery journey end-to-end:

1. Owner registers/logs in.
2. Owner submits intake form with optional social links.
3. System opens WebSocket progress and shows research stages.
4. `IntelligenceGatherer` reads submitted-link metadata.
5. Free/no-key search gathers bounded market and competitor context.
6. Research facts include source labels/citations.
7. Wrong or low-confidence matches are discarded.
8. Discovery chat opens only after research is complete or partially complete.
9. Discovery asks one question at a time in Arabic, English, or mixed language.
10. Discovery refuses strategy/content requests during interview.
11. Discovery produces schema-valid `BusinessProfileDraft`.
12. Draft separates confirmed facts, research observations, uncertainties, owner goals, and strategy-relevant notes.
13. Owner confirms the profile.
14. Strategy remains locked until confirmation.

Required proof:

- API demo transcript for start/status/respond/summarize/confirm.
- WebSocket progress transcript or screenshot.
- Evaluation cases for Arabic, English, mixed language, unknown answer, contradiction, strategy request, and prompt injection.
- Example validated `BusinessProfileDraft` JSON.
- Evidence that source labels/citations are present for owner-visible research facts.

## GitHub Issues and Projects note

Sprint 1 should be tracked with GitHub Issues and one GitHub Project named:

```text
MarketMind AI
```

Use `github_sprint_1_issue_packets.md` in this folder as the readable source of truth for Sprint 1 issue bodies.

The GitHub Project board has been created:

```text
https://github.com/users/ARabee3/projects/1
```

Pull requests should mention or close their related issue.
