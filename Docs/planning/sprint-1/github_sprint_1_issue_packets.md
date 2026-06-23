# Sprint 1 GitHub Issue Packets

This file is the readable source of truth for Sprint 1 GitHub Issues.

Each issue should be detailed enough for a teammate or AI coding agent to start safely without constantly jumping back to the planning docs.

Common related docs for all Sprint 1 issues:

- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
- `Docs/planning/05_TEAM_OPERATING_SYSTEM.md`
- `Docs/planning/03_AGENTS_OVERVIEW.md`
- `README.md`

---

<!-- ISSUE 1 START -->
## #1 Implement Discovery Agent flow contract

## Owner / Reviewer

Owner: Ahmed  
Reviewer: Mokhtar  
Estimate: Medium  
Sprint Status: Sprint Ready

## Goal

Define and implement the first contract for the Discovery Agent flow so the NestJS backend team can understand how the backend will call the AI service and what structured responses to expect.

## Context

Sprint 1 starts the real Discovery AI foundation. This issue does not build the whole agent product. It defines the lifecycle and AI/Nest integration boundary for the first real agent so later implementation work does not drift or invent incompatible API shapes.

## In Scope

- Discovery session lifecycle: start, respond, summarize.
- AI service contract for the Discovery flow.
- Required request/response shapes at a draft level.
- Completion rules for when a Business Profile draft is ready.
- Explicit rule that Discovery does not create strategy or content.
- Examples that backend and AI teams can both understand.

## Out of Scope

- Full frontend UI.
- Auth/RBAC implementation.
- RAG, web search, or competitor research.
- Content generation.
- Publishing or analytics.
- Final production database schema.

## Expected Deliverables

- A documented AI/Nest contract for Discovery.
- Lifecycle/state notes for the Discovery session.
- Example request/response payloads for the three endpoints.
- Notes on error cases and provider failure behavior from the caller perspective.

## Suggested Implementation Steps

- [ ] Read the Sprint 1 vertical slice doc and Discovery Agent section.
- [ ] Define Discovery lifecycle states: `not_started`, `in_progress`, `summary_ready`, `confirmed`, `failed`.
- [ ] Draft request/response examples for `start`, `respond`, and `summarize`.
- [ ] Define what data NestJS must send to the AI service on each call.
- [ ] Define what the AI service must return to NestJS on each call.
- [ ] Document when strategy remains locked.
- [ ] Add notes for provider failure and retry-safe behavior.
- [ ] Review contract with Mokhtar from the backend perspective.

## Interfaces / Contracts

Expected AI service endpoints:

```text
POST /ai/discovery/start
POST /ai/discovery/respond
POST /ai/discovery/summarize
```

Minimum response intent:

- next question
- updated known facts
- updated uncertainties
- whether the profile draft is ready
- safe error message if the provider fails

## Acceptance Criteria

- [ ] NestJS team can explain how to call the AI service for Discovery.
- [ ] The contract includes start, respond, and summarize behavior.
- [ ] The contract uses structured inputs/outputs, not free-form-only text.
- [ ] Discovery is explicitly forbidden from strategy/content generation.
- [ ] The profile confirmation boundary is clear.
- [ ] The issue outcome is understandable without reading every planning doc.

## Test / Verification

- [ ] Walk through one fictional Egyptian cafe from start to summary.
- [ ] Show an example request/response for each endpoint.
- [ ] Show what happens if the user says “I don’t know.”
- [ ] Show what happens if the AI provider fails.
- [ ] Paste contract examples or screenshots into the PR.

## Review Checklist

- [ ] Owner can explain the lifecycle and handoff to Strategy.
- [ ] Reviewer checked that the contract is backend-friendly.
- [ ] Reviewer checked that Discovery does not do strategy/content work.
- [ ] AI-critical behavior was reviewed by Ahmed or Merzek.

## AI Assistance Rules

AI tools may help draft contracts and examples, but Ahmed must understand, verify, and explain every field and lifecycle decision.

## Related Docs

- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
- `Docs/planning/03_AGENTS_OVERVIEW.md`
<!-- ISSUE 1 END -->

---

<!-- ISSUE 2 START -->
## #2 Implement real AI provider adapter and Discovery prompt

## Owner / Reviewer

Owner: Merzek  
Reviewer: Gerges  
Estimate: Medium  
Sprint Status: Sprint Ready

## Goal

Build the first real AI provider path for Discovery using an OpenAI-first adapter and a safe Discovery Agent prompt that supports Arabic, English, and mixed-language interviews.

## Context

The team decided not to use mocked AI as the main path. This issue creates the real AI foundation, but keeps the agent focused on Discovery only. The provider adapter should be replaceable later so Gemini or another provider can be added without rewriting the agent flow.

## In Scope

- OpenAI-first provider adapter.
- Discovery Agent prompt skeleton.
- Structured response expectations.
- Provider failure behavior.
- Bilingual Arabic/English and code-switching support.
- No-invention rules and uncertainty handling.
- Basic tracing/logging plan for provider calls.

## Out of Scope

- RAG.
- Web search.
- Strategy generation.
- Content generation.
- Image/logo/menu analysis.
- Production cost optimization.
- Full LangGraph orchestration.

## Expected Deliverables

- Provider adapter design or initial implementation.
- Discovery prompt draft.
- Structured response examples.
- Provider failure behavior notes.
- Minimal guidance for environment variables/secrets, without committing secrets.

## Suggested Implementation Steps

- [ ] Read the Discovery Agent requirements from the planning docs.
- [ ] Define provider adapter responsibilities: input, output, errors, model configuration.
- [ ] Draft a Discovery system prompt with strict boundaries.
- [ ] Define structured output fields for next question vs profile draft.
- [ ] Add Arabic/English/mixed-language instructions.
- [ ] Add rules for unknowns, contradictions, and off-topic messages.
- [ ] Document provider failure handling.
- [ ] Review with Gerges for backend/API compatibility.

## Interfaces / Contracts

The adapter should expose a provider-neutral shape, for example:

```text
runDiscoveryTurn(input) -> DiscoveryTurnResult
```

The result should clearly indicate one of:

- ask next question
- ask clarification
- produce profile draft
- safe failure

## Acceptance Criteria

- [ ] Real AI call path is defined or started.
- [ ] Prompt supports Arabic, English, and mixed input.
- [ ] Prompt forbids invented business facts.
- [ ] Prompt forbids strategy/content generation.
- [ ] Structured response expectations are documented.
- [ ] Provider failure produces a safe retryable result.

## Test / Verification

- [ ] Test Arabic-only input.
- [ ] Test English-only input.
- [ ] Test mixed Arabic/English input.
- [ ] Test “I don’t know.”
- [ ] Test a prompt-injection style user message.
- [ ] Test or document provider failure behavior.

## Review Checklist

- [ ] Owner can explain the prompt boundaries.
- [ ] Reviewer checked that outputs are backend-friendly.
- [ ] Reviewer checked that the adapter avoids provider lock-in.
- [ ] AI-critical prompt/provider decisions were reviewed by Ahmed or Merzek.

## AI Assistance Rules

AI may help draft prompt variants, but Merzek must test, simplify, and remove unsafe or invented behavior before review.

## Related Docs

- `Docs/planning/01_AI_CONCEPTS_FOR_THE_TEAM.md`
- `Docs/planning/03_AGENTS_OVERVIEW.md`
- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
<!-- ISSUE 2 END -->

---

<!-- ISSUE 3 START -->
## #3 Implement Discovery schemas and AI evaluation cases

## Owner / Reviewer

Owner: Kordy  
Reviewer: Abdulazim  
Estimate: Medium  
Sprint Status: Sprint Ready

## Goal

Define the first Discovery data shapes and evaluation cases so AI output can be validated and shared safely between the AI service, NestJS API, and future frontend.

## Context

The Discovery Agent must not return vague free-form text only. This issue creates the structure needed for reliable AI behavior, future database storage, and human review. It also gives the team concrete evaluation cases before deeper implementation.

## In Scope

- `DiscoverySession`
- `DiscoveryMessage`
- `BusinessProfileDraft`
- `BusinessProfile`
- `Uncertainty`
- `AgentRun`
- Example valid objects.
- AI evaluation cases for Discovery.

## Out of Scope

- Final database migrations.
- Full shared package implementation if the backend is not ready.
- Strategy schemas.
- Content schemas.
- Publishing or analytics schemas.

## Expected Deliverables

- Schema draft or shared contract draft.
- Example valid Discovery objects.
- Evaluation case list with expected behavior.
- Notes on which fields are required for Sprint 1.

## Suggested Implementation Steps

- [ ] Read Discovery flow and agent overview docs.
- [ ] Draft the required Discovery schema names and responsibilities.
- [ ] Define minimum required fields for each schema.
- [ ] Include explicit uncertainty tracking.
- [ ] Include source tracking where useful, such as owner answer vs AI observation.
- [ ] Write example valid objects for a fictional Egyptian cafe.
- [ ] Write the first evaluation cases.
- [ ] Review with Abdulazim for future frontend/API usability.

## Interfaces / Contracts

Schemas must support:

- interview state
- message history
- current known business facts
- missing/uncertain fields
- profile draft
- confirmed profile later
- AI run trace metadata

## Acceptance Criteria

- [ ] Schemas are usable by both AI and NestJS streams.
- [ ] Unknowns can be represented without invention.
- [ ] Profile draft and confirmed profile are clearly separate.
- [ ] Evaluation cases cover the required Discovery behaviors.
- [ ] Outputs can be validated manually or programmatically.

## Test / Verification

- [ ] Arabic interview case.
- [ ] English interview case.
- [ ] Mixed-language interview case.
- [ ] Unknown budget case.
- [ ] Unknown competitors case.
- [ ] Contradictory answer case.
- [ ] Prompt-injection case.
- [ ] Provider failure case.

## Review Checklist

- [ ] Owner can explain every schema.
- [ ] Reviewer checked that schemas are not overcomplicated.
- [ ] Reviewer checked that frontend/API can consume them later.
- [ ] AI-critical schema decisions were reviewed by Ahmed or Merzek.

## AI Assistance Rules

AI may help generate sample schemas and test cases, but Kordy must verify that every field is needed and explainable.

## Related Docs

- `Docs/planning/02_MARKETMIND_AI_FLOW.md`
- `Docs/planning/03_AGENTS_OVERVIEW.md`
- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
<!-- ISSUE 3 END -->

---

<!-- ISSUE 4 START -->
## #4 Initialize NestJS backend repo and Health endpoint

## Owner / Reviewer

Owner: Abdulazim  
Reviewer: Kordy  
Estimate: Medium  
Sprint Status: Sprint Ready

## Goal

Initialize the NestJS backend foundation inside the monorepo and add only the minimal health endpoint and module structure needed for Sprint 1 backend work.

## Context

Sprint 1 backend work starts with Auth/RBAC. Those tasks need a clean NestJS project foundation, but the repo should not grow fake modules or product features too early. This issue creates the backend base while intentionally deferring audit and business logic.

## In Scope

- NestJS app initialization under `apps/api`.
- Basic project structure.
- Environment config approach.
- `HealthModule`.
- Placeholder/module layout for:
  - `AuthModule`
  - `UsersModule`
  - `RbacModule`
  - `HealthModule`
- `GET /health`.

## Out of Scope

- `AuditModule`.
- Business/Profile APIs.
- Discovery APIs.
- Database-heavy feature implementation.
- Docker Compose.
- CI workflow.
- Frontend work.

## Expected Deliverables

- Runnable NestJS backend skeleton.
- Health endpoint returning a simple healthy response.
- Clear local run instructions.
- No production feature logic beyond foundation.

## Suggested Implementation Steps

- [ ] Confirm the npm workspace structure.
- [ ] Initialize NestJS under `apps/api`.
- [ ] Keep dependencies minimal.
- [ ] Add module layout for Auth, Users, RBAC, and Health.
- [ ] Implement `GET /health`.
- [ ] Document how to run the backend locally.
- [ ] Confirm no `AuditModule` exists.
- [ ] Review with Kordy for integration clarity.

## Interfaces / Contracts

Required endpoint:

```text
GET /health
```

Expected behavior:

- returns a simple healthy response
- does not require auth
- does not check database/Redis/AI service yet

## Acceptance Criteria

- [ ] Backend app starts locally.
- [ ] `GET /health` returns a healthy response.
- [ ] Module structure includes only Auth, Users, RBAC, and Health.
- [ ] No `AuditModule` is created in Sprint 1.
- [ ] Other backend members can start their issues without setup confusion.

## Test / Verification

- [ ] Run the backend locally.
- [ ] Call `GET /health`.
- [ ] Run the available backend checks/tests.
- [ ] Paste command output or screenshot into the PR.

## Review Checklist

- [ ] Owner can explain the project structure.
- [ ] Reviewer checked that no premature feature code was added.
- [ ] Reviewer checked that setup is easy for the team.
- [ ] Backend-sensitive setup was reviewed before merge.

## AI Assistance Rules

AI may help scaffold and explain NestJS setup, but Abdulazim must understand every generated file and remove unnecessary defaults.

## Related Docs

- `Docs/techstack.md`
- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
- `README.md`
<!-- ISSUE 4 END -->

---

<!-- ISSUE 5 START -->
## #5 Implement Auth APIs

## Owner / Reviewer

Owner: Mokhtar  
Reviewer: Ahmed  
Estimate: Medium  
Sprint Status: Sprint Ready

## Goal

Implement the first authentication APIs for owner accounts so protected backend work can begin safely.

## Context

Discovery, strategy, and future publishing must be tied to an authenticated owner. Sprint 1 does not need every auth feature, but it does need a safe register/login/session foundation that RBAC and future business ownership can build on.

## In Scope

- Owner registration.
- Login with email/password.
- Password hashing.
- Access token behavior.
- Refresh token behavior.
- Logout behavior.
- Current user endpoint.
- Safe error messages.
- Basic tests.

## Out of Scope

- Google OAuth.
- Password reset.
- Email verification.
- Account deletion.
- Full business ownership APIs.
- Admin UI.
- Frontend auth pages.

## Expected Deliverables

- Auth controller/service/DTOs.
- User persistence approach compatible with the backend setup.
- Token/session handling.
- Tests for successful and failed auth flows.
- Notes for how RBAC will consume current user identity.

## Suggested Implementation Steps

- [ ] Confirm backend setup from issue #4.
- [ ] Define auth DTOs and validation rules.
- [ ] Implement password hashing.
- [ ] Implement owner registration.
- [ ] Implement login and token response.
- [ ] Implement refresh and logout behavior.
- [ ] Implement `GET /auth/me`.
- [ ] Add tests for happy and failure paths.
- [ ] Review with Ahmed for product/security fit.

## Interfaces / Contracts

Required endpoints:

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET /auth/me
```

Minimum role after registration:

```text
owner
```

## Acceptance Criteria

- [ ] Owner can register.
- [ ] Duplicate email is rejected.
- [ ] Password is hashed and never returned.
- [ ] Login returns usable tokens.
- [ ] Wrong password is rejected safely.
- [ ] Refresh works.
- [ ] Logout invalidates the refresh session.
- [ ] `/auth/me` requires authentication.

## Test / Verification

- [ ] Register success test.
- [ ] Duplicate email failure test.
- [ ] Login success test.
- [ ] Wrong password failure test.
- [ ] Refresh token success test.
- [ ] Logout invalidation test.
- [ ] `/auth/me` protected test.
- [ ] Paste test output or API screenshots into the PR.

## Review Checklist

- [ ] Owner can explain token/session behavior.
- [ ] Reviewer checked that password handling is safe.
- [ ] Reviewer checked that auth integrates with RBAC.
- [ ] Security-sensitive work received required review.

## AI Assistance Rules

AI may help generate boilerplate, DTOs, and tests, but Mokhtar must verify security behavior and remove insecure shortcuts.

## Related Docs

- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
- `Docs/planning/05_TEAM_OPERATING_SYSTEM.md`
<!-- ISSUE 5 END -->

---

<!-- ISSUE 6 START -->
## #6 Implement RBAC roles permissions and guards

## Owner / Reviewer

Owner: Gerges  
Reviewer: Merzek  
Estimate: Medium  
Sprint Status: Sprint Ready

## Goal

Implement the first role/permission model and guard pattern so backend endpoints can be protected by permissions instead of ad-hoc checks.

## Context

The product will need strict approval gates and ownership checks. Sprint 1 starts with simple RBAC so future Discovery and Strategy endpoints can be protected from the beginning.

## In Scope

- Initial roles.
- Initial permissions.
- Guard/decorator pattern.
- Current-user permission resolution.
- Basic protected route behavior.
- Tests for allow/deny decisions.

## Out of Scope

- Full admin UI.
- Organization/team workspaces.
- Agency RBAC.
- Multi-business ownership rules.
- Complex policy engine.
- Audit module implementation.

## Expected Deliverables

- Permission model.
- Role-to-permission mapping.
- Guard/decorator usage pattern.
- Current user permission lookup.
- Basic tests or demo protected endpoint.

## Suggested Implementation Steps

- [ ] Confirm Auth current-user shape from issue #5.
- [ ] Define initial roles.
- [ ] Define initial permissions.
- [ ] Create role-to-permission mapping.
- [ ] Implement permission guard/decorator pattern.
- [ ] Add current-user permission resolution.
- [ ] Add tests for allowed and denied access.
- [ ] Review with Merzek for agent-flow protection.

## Interfaces / Contracts

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

Expected behavior:

- protected routes declare required permission
- current user permissions are resolved consistently
- missing permission returns a safe forbidden response

## Acceptance Criteria

- [ ] Protected routes can require permissions.
- [ ] Owner permissions are returned correctly.
- [ ] Valid permission is allowed.
- [ ] Missing permission is rejected.
- [ ] RBAC is ready to protect future Discovery endpoints.
- [ ] No audit module is introduced here.

## Test / Verification

- [ ] Test owner permission list.
- [ ] Test route allowed with valid permission.
- [ ] Test route rejected with missing permission.
- [ ] Test unauthenticated access rejected where relevant.
- [ ] Paste test output or API examples into the PR.

## Review Checklist

- [ ] Owner can explain roles vs permissions.
- [ ] Reviewer checked that RBAC protects future agent actions.
- [ ] Reviewer checked that implementation is not overengineered.
- [ ] Security-sensitive work received required review.

## AI Assistance Rules

AI may help draft guards/decorators, but Gerges must understand and test the authorization behavior.

## Related Docs

- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
- `Docs/planning/05_TEAM_OPERATING_SYSTEM.md`
<!-- ISSUE 6 END -->

---

<!-- ISSUE 7 START -->
## #7 Plan future audit events for approval-sensitive actions

## Owner / Reviewer

Owner: Unassigned  
Reviewer: Ahmed or Merzek  
Estimate: Small  
Sprint Status: Backlog

## Goal

Define future audit event requirements for approval-sensitive actions without implementing an `AuditModule` in Sprint 1.

## Context

Audit will matter when the system has real approval gates and AI-sensitive decisions. The team intentionally deferred `AuditModule` from Sprint 1 to avoid premature architecture. This issue stays in Backlog until the product reaches meaningful approval events.

## In Scope

- Future audit event list.
- Approval-sensitive action inventory.
- Minimum fields for future audit events.
- Notes about why audit is deferred from Sprint 1.

## Out of Scope

- Creating `AuditModule`.
- Database migrations.
- Audit UI.
- Logging provider selection.
- Implementing event storage.

## Expected Deliverables

- Future audit event checklist.
- Recommended audit fields.
- Confirmation that Sprint 1 does not include an audit implementation.

## Suggested Implementation Steps

- [ ] Review future approval points in the product journey.
- [ ] List audit events for profile confirmation.
- [ ] List audit events for strategy approval/rejection.
- [ ] List audit events for publishing approval.
- [ ] List audit events for optimization approval.
- [ ] List audit events for AI-sensitive decisions.
- [ ] Define minimum event fields.
- [ ] Keep issue in Backlog until audit becomes implementation-ready.

## Interfaces / Contracts

Future audit event examples:

```text
profile.confirmed
strategy.approved
strategy.rejected
content.approved
publishing.approved
optimization.approved
ai.agent_run.completed
ai.agent_run.failed
```

Potential future fields:

- actor
- action
- target type
- target id
- timestamp
- source IP or session id when appropriate
- before/after summary when appropriate

## Acceptance Criteria

- [ ] Future audit targets are listed.
- [ ] Minimum audit fields are proposed.
- [ ] It remains clear that `AuditModule` is not part of Sprint 1.
- [ ] The issue stays in Backlog until approval-sensitive implementation begins.

## Test / Verification

- [ ] Confirm no `AuditModule` exists in Sprint 1 implementation.
- [ ] Confirm future audit requirements are understandable to backend and AI teams.

## Review Checklist

- [ ] Owner can explain why audit is deferred.
- [ ] Reviewer checked that future audit targets match the product journey.
- [ ] Reviewer checked that this does not create implementation pressure in Sprint 1.

## AI Assistance Rules

AI may help brainstorm audit events, but the team must verify that each event maps to a real product action.

## Related Docs

- `Docs/planning/02_MARKETMIND_AI_FLOW.md`
- `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`
<!-- ISSUE 7 END -->
