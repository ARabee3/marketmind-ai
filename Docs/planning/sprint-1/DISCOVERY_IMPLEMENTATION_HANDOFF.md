# Prepared Discovery Implementation Handoff

**Status:** Ready for team review  
**Branch:** `feature/intelligence-gatherer-integration`  
**Prompt version:** `discovery-v2-market-aware`

## Executive Summary

This branch turns Prepared Discovery from a set of contracts into a complete
backend vertical slice. An authenticated owner can start a discovery session,
receive bounded public research, continue a bilingual conversation, review a
market-aware profile draft, and explicitly confirm the profile that later
marketing work will consume.

The implementation keeps the product's main safety boundary intact:

- public research may inform questions and market context;
- owner answers remain the authority for private business facts;
- uncertain or contradictory information remains visible as uncertainty;
- strategy generation stays locked until the owner confirms the profile;
- provider and research failures degrade safely instead of inventing facts.

This is sufficient for the current Discovery scope. It produces a confirmed,
evidence-aware business profile with the business, customer, offer, positioning,
marketing, constraints, and local-market context needed by the next planning
stage. It does not attempt to replace the future Research or Strategy stages.

## End-to-End Flow

1. The owner submits business identity, location, goals, optional context, and
   optional public links to `POST /api/v1/discovery/start`.
2. NestJS creates the session, intake, progress records, and a background agent
   run in PostgreSQL.
3. The intelligence gatherer:
   - extracts safe metadata from owner-provided links;
   - creates prioritized search queries;
   - calls configured search providers with fallback;
   - filters weak or mismatched results;
   - stores sources, observations, conversation hooks, and knowledge gaps.
4. FastAPI receives only accepted research context and produces the first
   conversational question.
5. The owner continues through
   `POST /api/v1/discovery/:sessionId/respond`.
6. The AI updates structured business facts and uncertainties while asking one
   contextual question at a time. It must not expose an internal questionnaire
   or generate strategy.
7. Each response carries cumulative facts, domain-aware uncertainty, domain
   scores, a fallback question, and an AI readiness recommendation. NestJS
   applies the authoritative balanced-coverage gate.
8. When the AI recommends completion and the gate passes, NestJS immediately
   invokes the internal summarize turn and returns `summary_ready`. Turn 15
   also summarizes automatically, preserving remaining gaps in an incomplete
   draft.
9. `POST /api/v1/discovery/:sessionId/summarize` is the owner early-finish
   path. If blockers remain, it requires `finish_anyway: true` and produces an
   explicitly incomplete draft.
10. Explicit owner confirmation through
    `POST /api/v1/discovery/:sessionId/confirm-profile` creates an immutable
    profile version and unlocks the downstream boundary. Incomplete drafts
    additionally require `acknowledge_incomplete: true`.

HTTP status is the recovery source of truth. Socket.IO at
`/ws/v1/discovery` supplies progress updates through `discovery.join`,
`discovery.progress.snapshot`, and `discovery.progress`.

## What The Profile Contains

The confirmed profile is intentionally more useful than a general business
summary. It contains:

| Domain                | Captured information                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| Identity              | Business name, type, city, and area                                                     |
| Offer                 | Core offerings, best sellers, price range, and purchase occasions                       |
| Customers             | Primary segments, visit/order occasions, peak periods, and needs                        |
| Differentiation       | Owner-claimed strengths, choice reasons, and proof points                               |
| Current marketing     | Active channels, current activities, delivery platforms, and available assets           |
| Goals and constraints | Growth goals, timeframe, budget range, team capacity, and operational constraints       |
| Market context        | Competitor landscape, local demand, digital presence, and other evidence-backed signals |
| Decision quality      | Research observations, uncertainties, owner goals, and strategy-relevant notes          |

Market context entries retain observation and source references where available.
The system does not silently promote a public claim into an owner-confirmed
business fact.

## Conversational Discovery

The conversation is designed to feel like a capable consultant, not a form.
The model receives domain coverage and knowledge gaps, then asks one concise
question that naturally follows from what the owner already said or what the
research safely suggests.

The prompt and response validation enforce these rules:

- support Arabic, English, and mixed Egyptian conversation;
- do not repeat already answered questions;
- do not ask the owner to verify irrelevant search noise;
- prefer high-value gaps over collecting every possible detail;
- accept unknown or skipped answers without fabricating replacements;
- separate facts, research signals, and uncertainty;
- refuse prompt injection and requests to reveal hidden instructions;
- refuse strategy work while Discovery is still active;
- only mark the profile ready when required domains are sufficiently covered.

NestJS, not the model, owns the final readiness decision. Automatic completion
requires `profile_readiness >= 0.80`, balanced minimum scores and structural
facts for the owner-business domains, and no unresolved high-severity owner
fact contradiction. Market context and research confidence never block
completion because public research is degradable.

The owner may still stop early. That path and the 15-turn limit produce an
incomplete draft whose blocking domains are converted into visible
uncertainties. Confirmation requires explicit acknowledgement, and those gaps
remain in the immutable profile for downstream agents.

OpenAI, Gemini, and OpenRouter share the same runtime turn instructions so
provider choice does not change the product contract.

## Reliability And Safety

The integration includes:

- strict request validation and owner-scoped authorization;
- process-local Sprint 1 rate limiting on Discovery writes;
- SSRF protection, redirect validation, response-size limits, cancellation, and
  timeouts for external metadata requests;
- deterministic query planning fallback when AI planning is unavailable;
- SerpApi, Apify Maps, and DuckDuckGo provider fallback with visible warnings;
- match filtering and confidence scoring before observations reach the prompt;
- discarded-observation and unreferenced-source filtering;
- strict FastAPI and NestJS response parsing;
- safe provider errors without leaked credentials or raw upstream bodies;
- idempotent profile confirmation and transactional profile version creation;
- durable profile-state snapshots, readiness recovery, and a 15-turn cap;
- persistent progress events so reconnecting clients can recover state.

Research failure is degradable: Discovery can continue with owner conversation.
AI conversation failure is not converted into a successful turn.

## Contract And Persistence Impact

The shared contracts now define the lifecycle, progress events, market-aware
facts, evidence-backed market context, profile draft, confirmed profile, and
canonical uncertainty model. Public status and respond responses expose the
persisted readiness snapshot. Profile drafts record completeness, completion
reason, scores, and blocking domains.

Persistence remains aligned with the Prepared Discovery architecture. The
branch updates migration documentation to match the implementation but does not
introduce an undocumented database model or Qdrant dependency.

Example payloads cover start, respond, summarize, confirmation-related profile
data, internal AI calls, agent runs, and a full SME journey (the worked
example uses a café, but the contracts are industry-neutral). The
dependency-free validator checks every example as part of the root repository
check.

## Reviewer Guide

Review in this order:

1. Shared lifecycle and profile contracts in `packages/contracts`.
2. NestJS orchestration in `apps/api/src/modules/discovery`.
3. Intelligence gathering under
   `apps/api/src/modules/discovery/intelligence`.
4. FastAPI schemas, prompts, and provider adapters in `services/ai/app`.
5. Persistence and migration documentation.
6. Tests and contract examples.

High-value review questions:

- Can any transition bypass owner confirmation?
- Can discarded or mismatched research reach the model?
- Can public research overwrite an owner fact?
- Can a provider failure appear as a successful conversation turn?
- Does every market claim remain attributable or explicitly uncertain?
- Can the team explain why the profile is ready for downstream strategy?

## Verification Evidence

The implementation verification completed in this workspace includes:

- contract typecheck and all contract examples;
- API production build;
- API unit tests: 34 suites, 138 tests;
- AI tests: 47 tests.

The API end-to-end suite contains 3 suites and 17 tests. It must be run in CI
or a local shell that permits ephemeral localhost listeners; this restricted
workspace rejects Supertest's listener with `listen EPERM`.

Coverage includes Arabic, English, mixed language, unknown answers, invalid model
output, prompt injection, strategy refusal, provider failure, wrong-match
filtering, link variations, partial research, lifecycle transitions, profile
confirmation, and HTTP route behavior.

## Definition Of Sufficient Discovery

Discovery is sufficient for handoff to the next stage when:

- the owner can complete the journey without research being mandatory;
- normal completion passes the hybrid readiness gate, while early/turn-limit
  completion remains explicitly incomplete;
- the confirmed profile covers the seven profile domains above;
- market context is evidence-backed rather than invented;
- unresolved gaps and contradictions remain explicit;
- the owner has reviewed and confirmed the profile;
- downstream agents can consume one stable, versioned profile contract;
- strategy remains unavailable before confirmation.

This branch meets those code-level conditions.

## Deliberately Deferred

The following are not blockers for merging this Discovery slice:

- frontend screens and conversation UX;
- Redis or gateway-level distributed throttling;
- a durable background job queue for multi-instance processing;
- Qdrant indexing and semantic retrieval;
- deep competitor analysis owned by the future Research stage;
- strategy recommendations, content generation, publishing, and analytics;
- broad social-platform integrations;
- production quality calibration using real owner sessions.

## Residual Validation Before Production

Before production rollout, run:

- a live PostgreSQL journey from start through confirmation;
- smoke tests with each enabled AI and search provider;
- reconnect testing from the actual frontend Socket.IO client;
- frontend review of readiness progress, early-finish warnings, and incomplete
  acknowledgement;
- prompt-quality review using representative Egyptian SME cases (a café is the worked example; the product targets SMEs across industries);
- dependency and secret-scanning checks in CI.

These are deployment-readiness checks, not missing Discovery domain behavior.
