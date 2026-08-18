# Facebook Optimization Decision and Content Handoff (Optimization 2)

Issue #223 adds the owner decision boundary for the Facebook-only Optimization
journey. It is a bounded, suggest-only copy handoff: an owner may approve or
dismiss one immutable proposal, and an approved cue may be consumed once by the
normal Content V2 generation path. It never edits Strategy, the weekly plan,
scheduling, or publishing state.

## Owner API

All routes are owner-scoped and require `BUSINESS_READ`:

- `GET /api/v1/performance/optimization/proposals` returns the workspace list.
- `GET /api/v1/performance/optimization/proposals/:proposalId` returns one
  workspace read model.
- `POST /api/v1/performance/optimization/proposals/:proposalId/decisions`
  accepts:

  ```json
  {
    "action": "approve",
    "evidence_checksum": "<the immutable proposal checksum>",
    "idempotency_key": "<1-256 character owner request key>",
    "note": "optional owner context"
  }
  ```

The server loads business, Strategy/version, cycle, format, instruction, and
evidence identity from the immutable proposal. The client cannot substitute a
different identity. A proposal has one terminal decision. Replaying the same
request identity returns the existing workspace; a different decision or stale
checksum returns a conflict.

## Persistence and lifecycle

Migration
`apps/api/prisma/migrations/20260818170000_add_optimization_decisions` adds:

- `optimization_decisions`: immutable, one-per-proposal owner decisions;
- `approved_optimization_instructions`: one instruction per approval,
  `PENDING_CONSUMPTION → CONSUMED` at most once, with exact pack/week-plan
  provenance;
- identity/checksum/status checks, uniqueness keys, foreign keys, and database
  triggers that reject mutation, deletion, or backward transitions.

The API exposes the derived workspace states
`PENDING_OWNER_DECISION`, `APPROVED_PENDING_CONSUMPTION`, `DISMISSED`,
`CONSUMED`, `SUPERSEDED`, and `EXPIRED`. Only the first two are actionable in
the current MVP; superseded/expired states are terminal audit states.

## Content V2 handoff

When an owner-planned, draft week is the current actionable week, NestJS looks
for the oldest pending instruction matching the exact business, Content cycle,
Strategy/version, and `text_post` or `static_image_post` format cohort. A
planner-only week, a historical/non-current week, an incompatible format, or an
already claimed pack leaves the instruction pending and does not regenerate or
mutate existing content.

The selected cue is copied into `ContentV2FrozenInput.optimization_guidance`.
`ContentPackRepository.claimQueuedPackV2` then freezes the plan, creates the
queued pack, and marks the instruction consumed in the same database
transaction. If the exact instruction identity, evidence checksum, or
owner-planned/format eligibility does not match, the transaction rolls back.

FastAPI receives the frozen cue as a bounded prompt context. It may influence
only hook or CTA wording for cards in the matching format cohort. Deterministic
plan alignment still enforces the original card count, order, channel, format,
purpose, audience, locale, media, CTA destination, and publish-window rules.
The generated item provenance records the instruction identity, proposal,
decision, format, change kind, and evidence checksum when that card is in the
matching cohort; the frozen input remains the authoritative handoff snapshot.

## Performance workspace

The bilingual `/performance` workspace shows each proposal's deterministic
metric comparison, evidence checksum, uncertainty, exact wording cue, eligible
current-week boundary, derived status, and the fields approval cannot change.
Approve and Dismiss are explicit owner actions. A terminal status replaces the
action buttons; no UI path regenerates a pack or publishes a post.

## Verification

Focused checks cover:

- contract and validation parity for decision/instruction/workspace states;
- repository/service/controller idempotency, stale-evidence, and one-decision
  behavior;
- migration trigger and uniqueness assertions, including the disposable
  PostgreSQL Optimization 2 invariant test;
- atomic instruction consumption during the Content V2 claim;
- owner-planned/matching-format frozen-input handoff;
- FastAPI prompt and provenance handling;
- Performance API and bilingual owner decision UI tests, dictionary parity, and
  the existing web accessibility/performance checks.

Live Facebook permissions, observations, and Meta quota still require human
verification. Local mocks prove the safety boundary only; they do not prove
provider readiness.
