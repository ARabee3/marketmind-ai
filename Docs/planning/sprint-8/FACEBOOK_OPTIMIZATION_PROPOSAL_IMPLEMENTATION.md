# Facebook Optimization Proposal (Optimization 1)

Issue #222 implements the first, suggest-only optimization slice for the
Facebook performance journey. It turns the immutable monitoring snapshots from
Performance 1–3 into one bounded recommendation that an owner may review
later. It does not approve, apply, schedule, or publish anything.

## Safety boundary

- Facebook is the only supported provider in this slice.
- The owner explicitly calls `POST /performance/optimization/proposals`.
  There is no scheduler and no automatic generation after a sync.
- NestJS is authoritative for owner scope, publication provenance, cohort
  selection, metric availability, medians, deltas, evidence checksums, and
  persistence.
- FastAPI receives only the sanitized optimization-v1 request. It never
  receives Meta credentials, raw Graph payloads, or a permission to publish.
- Captions and CTAs are quoted untrusted data. Instructions inside them must
  not change the provider's allowed output.
- A generated row is immutable and starts as `PENDING_OWNER_DECISION`.
  Approval/apply/publish is intentionally deferred to issue #223.

## Evidence eligibility

The analyzer chooses one exact cohort:

`business + Strategy id/version + Content cycle + Facebook + content format`

Only real MarketMind publications with an immutable, observed `7d` metric
snapshot are eligible. `text_post` and `static_image_post` are separate
cohorts; they are never mixed. The required metrics are exactly:

- `post_media_view`
- `post_clicks`

At least three complete snapshots are required. An available value of `0` is
data; an unavailable value is not coerced to zero. If the cohort is not ready,
the API returns typed readiness and does not call FastAPI. A complete but flat
cohort with no positive deterministic delta is also reported as
`insufficient_evidence/weak_signal`; it does not trigger an AI call.

For a ready cohort, NestJS sorts the snapshot references, computes the median,
best observed value, delta, and optional percentage delta for each required
metric, then hashes the canonical evidence references. The hash and the exact
snapshot IDs become the immutable generation identity and are sent to FastAPI
as the prepared `evidence_checksum` plus the same snapshot references.

## Contracts and persistence

The shared TypeScript contract lives under
`packages/contracts/src/performance/optimization-*` and has a strict Pydantic
mirror under `packages/contracts/python/performance_contracts.py`.

The persisted `OptimizationProposal` contains:

- business, Strategy/version, Content-cycle, format, and basis snapshot IDs;
- evidence checksum and deterministic comparisons;
- one allowed change kind: `hook_style` or `cta_wording_style`;
- summary, rationale, uncertainty, and a bounded instruction;
- model/prompt/contract versions, generation fingerprint, and status.

`apps/api/prisma/migrations/20260818150000_add_optimization_proposals` adds
the table, identity uniqueness, checks, foreign keys, and an immutable update /
delete trigger. No raw Meta response or credential field is stored.

## Internal AI boundary

FastAPI exposes:

`POST /internal/v1/ai/optimization/propose`

The route rejects fewer than three evidence entries before invoking a provider.
The provider may return exactly one bounded recommendation or a typed
`no_recommendation`. Invalid provider output gets at most one same-identity
repair attempt. FastAPI recomputes the prepared comparison invariants and both
services reject evidence-set, fingerprint, change-kind, prohibited-scope, or
unsupported causal/guaranteed/universal claim drift.

Local development uses the deterministic mock provider. OpenAI mode is an
explicit configuration choice; other modes report unavailable rather than
pretending to have live evidence.

## Owner API

- `GET /api/v1/performance/optimization/readiness?format=text_post`
- `POST /api/v1/performance/optimization/proposals`
- `GET /api/v1/performance/optimization/proposals`
- `GET /api/v1/performance/optimization/proposals/:proposalId`

All routes require the authenticated owner and `BUSINESS_READ`. The POST body
may select `text_post` or `static_image_post`. The canonical evidence and
generation fingerprint are the authoritative replay key, so identical retries
return the same immutable proposal without a second provider call.

## Verification

Focused verification for this issue includes:

- deterministic analyzer tests for medians, zero vs unavailable, provenance,
  format/identity separation, and cohort selection;
- NestJS repository, service, controller, and AI-client tests;
- FastAPI endpoint tests for strict fields, insufficient-baseline short-circuit,
  untrusted input, deterministic-math validation, unsupported claims, and
  bounded same-fingerprint repair;
- TypeScript and Pydantic contract example checks;
- Prisma schema validation and generated client checks;
- an isolated PostgreSQL migration test for fingerprint uniqueness, minimum
  evidence size, and update/delete immutability.

The controlled demo still requires the human owner to confirm that the
Facebook connection and three eligible 7-day snapshots are real before using
the Generate action. A green local mock test is not evidence of Meta quota,
permissions, or live account readiness.

Optimization 2 owner decisions and the one-time Content V2 handoff are
documented in
`FACEBOOK_OPTIMIZATION_DECISION_IMPLEMENTATION.md` (issue #223).
