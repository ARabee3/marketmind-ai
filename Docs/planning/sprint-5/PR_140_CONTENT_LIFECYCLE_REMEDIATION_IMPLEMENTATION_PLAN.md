# PR #140 Content Lifecycle Remediation Implementation Plan

**Status:** implementation handoff  
**Prepared:** 2026-08-04  
**Target PR:** [#140 — Feat/110 persist cycles packs and decisions](https://github.com/ARabee3/marketmind-ai/pull/140)  
**Target branch:** `feat/110-persist-cycles-packs-and-decisions`  
**Reviewed head:** `c7accfce203522cb150913343a9616aec9036a43`  
**Issue:** [#110 — Content API lifecycle](https://github.com/ARabee3/marketmind-ai/issues/110)

## 1. Objective

Finish PR #140 so the NestJS Content lifecycle can complete the real
`content-v1` owner journey safely:

1. an exact owner-approved Strategy starts one rolling 12-week Content cycle;
2. Week 1 is queued durably at cycle creation;
3. each later week is claimed exactly once and generated on the correct Cairo
   schedule through Week 12;
4. Strategy formats are converted deterministically to supported Content
   formats;
5. AI-generated item versions remain checksum-valid after a database
   round-trip;
6. media-required drafts automatically receive durable asset work and remain
   blocked until their exact assets are ready;
7. each exact item version receives at most one terminal owner decision and at
   most one publication candidate;
8. pack status, decisions, candidates, and their outbox events remain
   transactionally consistent;
9. Redis/BullMQ or webhook failures cannot permanently orphan generation,
   revision, asset, or publication-candidate work; and
10. the cycle becomes `completed` only after the Week-12 draft has been
    persisted successfully.

This plan supersedes the implementation claims in commit `c7accfc` where they
conflict with the behavior verified during re-review.

## 2. Mandatory source of truth

Read these files completely before editing:

- repository `AGENTS.md`;
- `Docs/planning/sprint-5/CONTENT_AGENT_AND_AUTOMATION_HANDOFF_ARCHITECTURE.md`;
- `Docs/planning/sprint-5/PUBLISHING_AUTOMATION_ARCHITECTURE.md`;
- `packages/contracts/CONTENT_CONTRACT.md`;
- `packages/contracts/src/content/`;
- GitHub issue #110 and the unresolved review on PR #140.

Preserve these frozen boundaries:

- Content generation never publishes;
- only explicit owner approval creates a `PublicationCandidateV1`;
- item versions and candidates are immutable;
- candidate status changes use separate versioned state events;
- missing or failed assets are never presented as ready;
- PostgreSQL is authoritative; Redis and BullMQ are delivery mechanisms;
- simulation or mock media must remain visibly labeled and must not be treated
  as real publication-ready output.

## 3. Scope and non-goals

### In scope

- PR #140 backend, contract-parity, FastAPI boundary, Prisma, queue, scheduler,
  asset, decision, candidate, outbox, and integration-test changes required by
  issue #110;
- forward-only schema changes and migrations needed to enforce invariants;
- resolving the PR's conflicts with the latest `main`;
- focused refactors that make transaction and retry boundaries explicit.

### Out of scope

- frontend work under `apps/web`;
- n8n workflow implementation or social-platform publishing;
- new channels beyond Facebook and Instagram;
- new Content formats beyond the four frozen `content-v1` formats;
- changing Strategy generation or the approved Strategy plan itself;
- broad infrastructure work unrelated to reliable local PostgreSQL/Redis test
  coverage.

## 4. Starting conditions and branch safety

The reviewed PR branch was 18 commits behind `main`, had no GitHub checks, and
had merge conflicts in:

- `apps/api/prisma/schema.prisma`;
- `apps/api/src/app.module.ts`;
- `apps/api/src/config/configuration.ts`;
- `apps/api/test/rbac.e2e-spec.ts`.

Before implementation:

1. inspect `git status` and preserve all unrelated user changes;
2. fetch `origin/main` and the PR branch;
3. work on `feat/110-persist-cycles-packs-and-decisions`, not the currently
   checked-out publishing branch;
4. merge the latest `origin/main` into the PR branch unless the user explicitly
   authorizes a history rewrite;
5. resolve all four conflicts while preserving both the Content module and the
   already-merged Publishing Automation module;
6. do not force-push;
7. run the baseline build and tests before behavioral edits, recording any
   failures that already exist on the merged branch.

Use a new forward-only migration for remediation. Do not delete or rewrite an
already-applied migration. If existing data violates a new unique constraint,
stop and report the duplicate rows; do not silently delete or rewrite them.

## 5. Target invariants

The implementation is complete only when the database and code enforce all of
the following.

### 5.1 Strategy and generation identity

- A cycle references one exact approved Strategy version, exact approval
  decision, matching owner, and matching confirmed profile version.
- Every generated request contains at least one supported Content format taken
  from the exact requested Strategy week.
- Unknown Strategy format labels fail closed when no supported mapping remains;
  the implementation must not fall back to every Content format.
- The generated pack, item IDs, item-version IDs, version numbers, timestamps,
  and checksums remain mutually consistent after persistence.

### 5.2 Week schedule and context

- The cycle has one immutable Week-1 schedule anchor.
- Week `N` starts exactly `7 * (N - 1)` Cairo calendar days after Week 1.
- The Week `N` generation cutoff is the start of Week `N + 1`.
- `nextGenerationAt` is a moving scheduler cursor, never the schedule anchor.
- Only Week 1 at cycle creation or the exact next eligible week may receive a
  new pack; replays may return/reconcile an already-claimed week.
- A context becomes immutable in the same transaction that claims its pack.
- Idempotent cycle creation cannot mutate Week-1 context after the pack exists.
- Week 13 is never created automatically.
- A cycle completes only after Week-12 generation reaches persisted `draft`.

### 5.3 Items, assets, decisions, and candidates

- Every item version is insert-only and checksum-valid after DB readback.
- An asset-required item version contains the exact asset IDs it expects before
  its checksum is frozen.
- Asset rows preserve those IDs and transition conditionally from
  `generating` to `ready`, `failed`, or `blocked`.
- Approval is blocked until every required referenced asset is ready,
  checksum-addressed, and retrievable.
- One exact item version has at most one terminal decision.
- Reusing an idempotency key with a different request fingerprint returns a
  conflict, not an unrelated replay.
- One exact approved item version has at most one immutable candidate.
- Item status, decision, candidate/outbox creation, and derived pack status are
  committed in one authoritative transaction.

### 5.4 Delivery and recovery

- PostgreSQL contains a durable intent before any BullMQ job is expected to
  exist.
- Every BullMQ job uses a deterministic job ID.
- A failed `queue.add` is repaired by a periodic reconciler without user action.
- Retryable worker failures remain claimable by the next Bull attempt.
- Terminal/non-retryable failures are visibly terminal and are not marked
  retry-eligible.
- Publication outbox rows are claimed atomically with a bounded lease.
- Missing webhook configuration, a process crash, or a webhook failure leaves
  the event recoverable.
- At-least-once delivery reuses the same `event_id` and `candidate_id`.

## 6. Implementation sequence

Complete the phases in order. Later phases depend on schema and canonicalization
decisions made earlier.

## Phase 0 — Sync `main`, establish the baseline, and isolate changes

### Work

1. Merge the latest `main` into the PR branch and resolve the four known
   conflicts.
2. Confirm that Prisma contains both Content and Publishing Automation models.
3. Confirm `AppModule` imports both modules once.
4. Preserve all configuration keys from both branches.
5. Preserve the expanded RBAC permission set and update E2E expectations to the
   merged authoritative set.
6. Run the baseline verification commands listed in Section 8.

### Exit criteria

- the branch is conflict-free against current `main`;
- `git diff --check` passes;
- baseline failures are documented before new code is added.

## Phase 1 — Add a deterministic Strategy-to-Content adapter

Create a focused adapter, preferably:

`apps/api/src/modules/content/content-strategy.adapter.ts`

Do not leave format parsing as a private helper in `content.processor.ts`.

### Required mapping

Normalize labels by trimming, lowercasing, and converting spaces/hyphens to
underscores. Apply this reviewed MVP mapping:

| Strategy labels | `content-v1` format |
| --- | --- |
| `static_image_post`, `static_image`, `photo`, `image`, `story` | `static_image_post` |
| `short_video_script`, `short_video`, `video`, `reel`, `reels` | `short_video_script` |
| `carousel_brief`, `carousel` | `carousel_brief` |
| `text_post`, `text`, `post`, `caption`, `poll`, `quiz`, `question` | `text_post` |

Pass through the four exact `CONTENT_FORMATS` values. Deduplicate mapped values
while preserving Strategy order. Drop unknown labels only when at least one
known mapping remains. If the requested week is missing, its formats are not an
array, or all labels are unsupported, throw a non-retryable
`CONTENT_SCHEMA_FAILURE` naming the exact Strategy field.

Do not return all formats as a fallback.

### Integration

- Use the adapter for both generation and revision envelopes.
- Keep selected-channel filtering deterministic and fail closed if no supported
  selected channel remains.
- Ensure the exact Strategy week's theme, formats, experiments, and cadence are
  represented in the generation input as required by the architecture.

### Tests

- Unit-test every mapping and normalization alias.
- Load `packages/contracts/examples/strategy-plan.example.json` and assert all
  12 weeks map to a non-empty supported set.
- Assert Week 1 maps `reels`, `photo`, `poll` to
  `short_video_script`, `static_image_post`, `text_post`.
- Assert an all-unknown week fails closed.
- Pass the resulting real request through
  `validateInternalContentGenerateRequest`.
- Add a cross-language fixture proving the same request is accepted by the
  FastAPI Pydantic request model.

## Phase 2 — Make Content item-version checksums round-trip safely

The current patch preserves IDs but changes `created_at` while retaining the AI
checksum. The checksum algorithm excludes only `version_checksum`, so this is
still invalid.

### Canonical checksum contract

Add a TypeScript checksum implementation under `packages/contracts/src/content/`
that mirrors Python's `compute_content_item_checksum`:

1. normalize all timestamps to one canonical UTC representation;
2. recursively sort object keys;
3. preserve array order and Unicode text;
4. serialize without insignificant whitespace;
5. exclude only `version_checksum`;
6. hash UTF-8 bytes with lowercase SHA-256.

Reuse or extract the repository's existing canonical-JSON implementation rather
than introducing a third incompatible serializer. Keep publishing checksum
behavior backward compatible.

Add fixed cross-language hash vectors for:

- Arabic captions and hashtags;
- `Z` versus `+00:00` timestamps;
- timestamps with sub-millisecond precision;
- nullable CTA/script fields;
- nested provenance and strategy-trace objects.

Both TypeScript and Python must produce the same hash for every vector.

### Nest-authoritative normalization

Before persistence:

1. validate the AI response checksum against the response bytes;
2. verify generated/revised IDs and relationships:
   - pack ID equals the claimed pack;
   - generated `content_item_id` is unique within the response;
   - revision `content_item_id` equals the requested item;
   - revision version equals base version plus one;
   - strategy trace matches exact Strategy/week/channel;
3. normalize `created_at` to the canonical representation that Nest will later
   expose;
4. recompute `version_checksum` over the normalized authoritative version;
5. persist every normalized field, including explicit `createdAt`, ID,
   `contentItemId`, version number, and recomputed checksum.

Update these repository inputs to carry `createdAt` explicitly:

- `ContentItemVersionDraftInput`;
- `AppendRevisedItemVersionInput`;
- any fixture/builders that create immutable versions.

Never change a field while retaining the checksum calculated over its previous
value.

### Tests

- Unit-test normalization and identity rejection.
- Add a real Prisma round-trip test:
  AI fixture → normalize → persist → query → `toContentItemVersion` → recompute
  checksum → exact match.
- Run the same test for revision N+1.
- Send the DB-round-tripped base version to the real FastAPI revision validator
  and assert it is accepted.
- Assert changing any immutable field invalidates the checksum.

## Phase 3 — Repair the 12-week schedule and freeze context atomically

### Schema

Add a stable schedule anchor to `ContentCycle`, for example:

```prisma
week1StartDate DateTime @map("week_1_start_date") @db.Date
```

Add an explicit freeze marker to `ContentWeekContext`, for example:

```prisma
frozenAt DateTime? @map("frozen_at")
```

If a different schema is selected, it must still make both invariants
database-enforceable: immutable schedule anchor and atomic open→frozen context
transition.

### Pure schedule helpers

Move date calculations into a dependency-free module, preferably:

`apps/api/src/modules/content/content-schedule.ts`

Expose helpers with these semantics:

```text
weekStart(week1StartDate, N) = week1StartDate + 7 * (N - 1) Cairo days
weekCutoff(week1StartDate, N) = weekStart(week1StartDate, N + 1)
```

`nextGenerationAt` must not be passed as the anchor. Cover Cairo DST boundaries
with calendar-date tests rather than adding fixed UTC milliseconds.

### Cycle creation

Create the following in one transaction:

- cycle with exact Strategy/profile/decision identities and Week-1 anchor;
- immutable Week-1 owner context;
- Week-1 queued pack/claim;
- durable generation-job intent.

Store a request fingerprint with the idempotency key. On replay:

- matching fingerprint returns the original cycle/context/pack identities;
- different fingerprint returns `CONTENT_VERSION_CONFLICT` or a dedicated
  idempotency conflict;
- no context row is updated.

### Context update and pack claim

- Owner updates must conditionally update only an open context.
- Pack claim must freeze the context and create the pack in the same transaction.
- Use a serializable transaction, row lock, or conditional update that prevents
  count-then-upsert races. A service-level `hasPackForWeek()` check alone is not
  sufficient.
- Safe-default creation must be subject to the same unique claim and freeze.
- Do not create safe defaults for arbitrary future weeks.

### Week eligibility

Allow a new pack only for:

- Week 1 during cycle creation; or
- `currentWeekNumber + 1` when the cycle is active and the scheduler/manual
  policy considers it eligible.

An existing pack for the requested week is an idempotent replay/reconciliation,
not a new claim. Reject skipped, historical-without-pack, and far-future weeks.

### Completion

Remove cycle completion from `ContentScheduler.progressWeeks()`. Complete the
cycle only in the successful Week-12 persistence path, after the pack reaches
`draft`. The completion update must verify:

- cycle is not already completed;
- pack belongs to the cycle;
- pack is Week 12;
- pack status is `draft`, `partially_approved`, or `approved` as allowed by the
  chosen completion definition;
- no Week-13 intent exists.

### Tests

- Pure date tests for Weeks 1–12 across Cairo DST changes.
- Sequential database test that claims all 12 weeks and asserts exact dates,
  cursor values, and one pack per week.
- Assert Week 12 remains active while queued/generating/failed.
- Assert successful Week-12 persistence completes once.
- Assert Week 13 is rejected.
- Concurrent owner-context update versus pack claim: exactly one outcome wins,
  and persisted generation observes immutable bytes.
- Cycle-create replay cannot change Week-1 context.
- Manual request cannot jump from Week 2 to Week 12.

## Phase 4 — Implement the complete media asset lifecycle

Ignoring `CONTENT_ASSET_REQUIRED` without planning and queueing an asset leaves
the item permanently unapprovable. Implement asset identity, association, work
intent, and state transitions as one lifecycle.

### Data model

Use a deterministic asset ID for each generated-static requirement, derived
from the immutable item-version identity and asset role. Preserve that ID in all
systems.

Support asset reuse explicitly. The preferred normalized model is a join table:

```prisma
model ContentItemVersionAsset {
  contentItemVersionId String @map("content_item_version_id") @db.Uuid
  assetId              String @map("asset_id") @db.Uuid

  contentItemVersion ContentItemVersion @relation(...)
  asset              ContentAsset       @relation(...)

  @@id([contentItemVersionId, assetId])
  @@map("content_item_version_assets")
}
```

Keep the frozen contract's `asset_ids` output consistent with this relation.
Do not rely on `ContentAsset.contentItemVersionId` alone if an approved prior
asset may be reused by another version.

### Draft persistence

For every asset-required version:

1. resolve and validate explicitly approved reusable assets; or
2. allocate deterministic generated-static asset IDs;
3. place the exact IDs in the normalized item version before computing its
   checksum;
4. create `ContentAsset` rows in `generating` state and version↔asset joins in
   the same transaction as the item version;
5. create deterministic asset-job intents in that transaction;
6. remove only the provisional missing-asset blocker represented by the planned
   work. Do not suppress unrelated asset-policy issues.

### Asset worker

- The job payload includes exact `assetId`, `contentItemVersionId`, dimensions,
  creative brief, alt text, and idempotency key.
- Verify FastAPI returns the same item-version and planned asset identity.
- Update the existing asset row conditionally; do not insert a new unrelated ID.
- Before setting `ready`, verify storage existence and checksum through the Nest
  `AssetStorage` port.
- On failure, retain the same asset ID and transition to `failed` with truthful
  failure metadata.
- Retries must not create additional asset rows or overwrite a prior version's
  bytes.

### Shared storage configuration

FastAPI currently writes image bytes while Nest serves them. Configure both
ports to the same durable root/shared volume:

- `CONTENT_ASSET_STORAGE_DIR` for FastAPI;
- `CONTENT_ASSET_ROOT` for NestJS.

Use the same absolute path in local/test deployment. Add a readiness check or
integration assertion that an asset stored by FastAPI is retrievable and
checksum-valid through Nest. If durable storage is unavailable, keep the asset
failed/missing; never create a fake ready row.

### Approval

- Load assets through exact version↔asset associations or exact `asset_ids`.
- Verify business/owner boundary for reused assets.
- Require supported kind, `ready` status, storage key, lowercase SHA-256, and
  retrievable bytes.
- Candidate assets must contain the same IDs/checksums validated at approval.

### Tests

- Generation automatically creates one deterministic asset job for a static
  image item.
- Approval while asset is `generating`, `failed`, or missing is blocked.
- Successful fake image generation makes the exact version approvable.
- Replaying the asset job reuses the same row and storage bytes.
- An approved prior asset can be reused without changing its original row.
- A cross-business or unapproved asset ID is rejected.
- Retrieval detects missing or tampered bytes.

## Phase 5 — Make generation, revision, and asset jobs durable and retry-safe

### Durable job intents

Add a PostgreSQL queue-intent outbox, for example:

```prisma
model ContentJobOutbox {
  id            String    @id @default(uuid()) @db.Uuid
  jobId         String    @unique @map("job_id")
  queueName     String    @map("queue_name")
  jobName       String    @map("job_name")
  payload       Json
  state         String    @default("pending")
  attempts      Int       @default(0)
  nextAttemptAt DateTime? @map("next_attempt_at")
  lastError     String?   @map("last_error")
  dispatchedAt  DateTime? @map("dispatched_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@index([state, nextAttemptAt])
  @@map("content_job_outbox")
}
```

Use it for:

- `generate-content`;
- `revise-content`;
- `generate-static-asset`.

Create each intent in the same transaction as the authoritative state change
that requires it.

### Reconciler

Add a periodic producer that:

1. claims due pending intents safely;
2. calls `queue.add` with deterministic `jobId` and bounded attempts/backoff;
3. marks the intent dispatched only after Bull confirms the job exists;
4. returns failures to pending with `nextAttemptAt`;
5. periodically reconciles old pending rows and rows whose lease expired.

Direct best-effort enqueue is allowed only as a latency optimization. The DB
intent and reconciler are the reliability mechanism.

### Worker state machine

For retryable failures:

- do not put the pack/item into a state the next Bull attempt refuses to claim;
- either keep an explicit processing attempt/lease or transition back to the
  retryable queued/requested state before throwing;
- mark terminal `failed`/`revision_failed` only on the final attempt or a
  non-retryable error;
- set `retryEligible` from the real error classification and bounded manual
  retry policy, not always `true`.

For generation, attempts 2–3 must actually call the provider again when the
prior error was retryable. For revision, a retryable failure must preserve the
base version and remain runnable. Manual retry must create/reuse a durable job
intent and deterministic job identity.

### Tests

- Fail the first two provider calls and assert the third attempt succeeds.
- Non-retryable validation failure makes no automatic provider retry and is not
  marked retry-eligible.
- `queue.add` failure after pack claim is repaired automatically without an
  owner replay.
- Scheduler-side enqueue failure does not skip the week.
- Revision retries preserve the base version and append exactly one N+1 row.
- Duplicate Bull delivery is a no-op after successful completion.

## Phase 6 — Enforce exact decisions, candidates, and pack status in one transaction

### Schema constraints

Add database uniqueness for the immutable boundaries:

```prisma
model ContentDecision {
  // existing fields
  requestFingerprint String @map("request_fingerprint")

  @@unique([contentItemVersionId])
  @@unique([ownerUserId, idempotencyKey])
}

model PublicationCandidate {
  // existing fields
  contentItemVersionId String @unique @map("content_item_version_id") @db.Uuid
}
```

Use equivalent indexes if naming differs. The exact version constraint must be
enforced by PostgreSQL, not only by a preceding `findFirst()`.

### Request fingerprinting

Fingerprint the immutable decision request fields:

- owner;
- pack and item identity;
- item-version ID, number, and checksum;
- decision;
- normalized revision notes.

On idempotency replay:

- same key + same fingerprint returns the original result;
- same key + different fingerprint returns a conflict;
- never return a decision/candidate belonging to another requested item.

### Single decision transaction

In one serializable/authoritative transaction:

1. load and lock the pack, item, and exact current version;
2. validate checksum, policy, ownership, and assets;
3. insert the decision under the exact-version unique constraint;
4. update item status conditionally;
5. if approved, insert/get the one candidate and candidate-created outbox row;
6. derive and update pack status using all current item versions/decisions;
7. commit.

The repository method that derives pack status must accept the caller's Prisma
transaction. Do not derive status after `queue.add`.

### Bulk decisions

- Reject or mark ineligible duplicate item/version entries within the request
  before writing.
- Also update the in-memory decided-version set after every successful insert.
- Keep the database exact-version unique constraint as the final concurrency
  guard.
- Apply all eligible item status changes, candidates, outbox rows, and the one
  derived pack update inside the same transaction.
- Define and test whether one invalid entry rejects the whole batch or returns
  per-item errors; keep behavior aligned with the frozen API contract.

An approve-then-reject pair for the same exact version must never produce two
decisions or leave an active candidate for a rejected item.

### Candidate state

Do not mutate an existing candidate. If a future explicit replacement/revocation
workflow is invoked, use `PublicationCandidateStatusV1` and a versioned
state-change outbox event. Do not implement a second terminal decision on the
same version as a shortcut.

### Tests

- Duplicate exact version twice in one bulk request.
- Approve/reject conflict for the same version.
- Same idempotency key with changed payload.
- Concurrent single decisions with different keys using real PostgreSQL;
  exactly one commits and the other receives `CONTENT_VERSION_CONFLICT`.
- Concurrent approvals create exactly one candidate and one created event.
- Queue failure after commit cannot leave the pack status stale.
- All approved current versions produce `approved`; some approved produce
  `partially_approved`; none approved remain `draft`.

## Phase 7 — Repair publication outbox claiming, dispatch, and recovery

The publication outbox row is already created transactionally with a candidate,
but delivery is not reliable because direct Bull enqueue is outside the
transaction, jobs have one attempt, pending polling is unused, and reads are not
claims.

### Claim model

Extend the outbox with a bounded processing lease, for example:

- `state`: `pending | processing | dispatched`;
- `leaseOwner`;
- `leaseExpiresAt`;
- `attempts`;
- `nextAttemptAt`;
- `lastError`;
- `dispatchedAt`.

Implement atomic `claimByEventId` and batch `claimDueEvents` operations. Use a
transaction with `FOR UPDATE SKIP LOCKED`, a conditional update, or an
equivalent PostgreSQL-safe pattern. A plain `findUnique()` is not a claim.

### Dispatch reconciler

- Periodically poll due pending or expired-lease events.
- Enqueue deterministic `dispatch-outbox` jobs keyed by `eventId`.
- Configure bounded Bull attempts/backoff.
- If `AUTOMATION_WEBHOOK_URL` is absent, release the lease to pending with a
  visible configuration error and a future retry; do not mark dispatched and do
  not rely on a completed one-shot job.
- On webhook failure, keep the same event identity, update attempts/backoff, and
  make it discoverable by both Bull retry and the DB sweep.
- On success, conditionally mark the claimed event dispatched.

At-least-once delivery permits a duplicate send if the process crashes after
the webhook accepts but before PostgreSQL is updated. The duplicate must contain
the same `event_id`, `candidate_id`, and checksum so the consumer can dedupe.

### Tests

- Candidate transaction commits while Redis is unavailable; later sweep
  dispatches the same event.
- Webhook configuration absent at first and present later; event eventually
  dispatches.
- Two workers race for one event; only one holds the live claim.
- Lease expires after worker crash and another worker recovers the event.
- Webhook failure observes DB backoff and retries the same event.
- Crash-after-send simulation may send twice but never changes event/candidate
  identity.

## Phase 8 — Add real integration coverage

The existing `apps/api/test/content.e2e-spec.ts` replaces `ContentService` with
a mock. Keep it as controller/auth coverage, but do not treat it as lifecycle
integration coverage.

Add tests using real PostgreSQL, Redis/BullMQ where relevant, the real
repositories/service/workers, and the deterministic FastAPI provider.

### Required suites

| Suite | Minimum behavior |
| --- | --- |
| Strategy→Content contract | Canonical Strategy example maps to a non-empty request accepted by TypeScript and FastAPI |
| Checksum round-trip | Generate and revise versions survive Prisma readback and Python checksum validation |
| 12-week scheduler | Weeks 1–12 have correct Cairo dates, one pack each, no drift, no Week 13 |
| Context race | Context update versus claim cannot mutate claimed bytes |
| Generation queue recovery | Redis failure and worker retries cannot orphan/skip a week |
| Asset lifecycle | Planned ID → job → ready bytes → approval/candidate; failure remains blocked |
| Decision concurrency | One terminal decision and one candidate under duplicate/concurrent calls |
| Pack lifecycle | Status derives transactionally after single and bulk decisions |
| Publication outbox | Redis/webhook/config/crash recovery reuses exact event identity |
| Week-12 completion | Failure remains active; successful draft persistence completes exactly once |

Do not use a mocked `ContentService` in these suites. Mock only external provider
behavior at its defined adapter boundary.

## 7. Expected file areas

The exact split may vary, but implementation should remain focused in these
areas:

- `packages/contracts/src/content/` — canonical item checksum and exports;
- `packages/contracts/scripts/` and contract fixtures — cross-language parity;
- `services/ai/app/content/validators.py` and content tests — checksum parity;
- `apps/api/prisma/schema.prisma` and a forward migration;
- `apps/api/src/modules/content/content-strategy.adapter.ts` — new;
- `apps/api/src/modules/content/content-schedule.ts` — new;
- `apps/api/src/modules/content/content.processor.ts`;
- `apps/api/src/modules/content/content.service.ts`;
- `apps/api/src/modules/content/content-scheduler.service.ts`;
- `apps/api/src/modules/content/repositories/`;
- a new durable job-outbox repository/reconciler;
- `apps/api/src/modules/content/outbox-dispatcher.ts`;
- `apps/api/src/modules/content/assets/`;
- API unit, DB integration, and E2E suites.

Avoid turning `content.service.ts` or `content.processor.ts` into larger
multi-responsibility files. Extract pure adapters, canonicalization, schedule,
and outbox responsibilities into focused modules.

## 8. Verification commands

Run from an isolated checkout of the final PR branch. Use an isolated test
database and Redis instance; do not point tests at shared or production data.

```bash
npm ci
npm run docker:up
npm run prisma:migrate:deploy
npm run check -w @marketmind/contracts
npm run build -w @marketmind/api
npm run typecheck -w @marketmind/api
npm run test -w @marketmind/api -- --runInBand
npm run test:db -w @marketmind/api
uv run --directory services/ai pytest tests/content -q
npm run test:e2e -w @marketmind/api
npm run check
git diff --check
```

If OAuth E2E uses a separate database URL, configure it correctly rather than
classifying an unverified run as passing. Record exact suite/test totals and any
environment-only skips.

Also verify:

- `npx prisma validate --schema apps/api/prisma/schema.prisma`;
- migrations apply from an empty database;
- migrations apply forward from the latest `main` schema;
- no GitHub merge conflicts remain;
- the PR has real CI checks or the complete command output is attached for human
  review.

## 9. Definition of Done

All boxes must be true before requesting re-review.

- [ ] Latest `main` is integrated without conflicts.
- [ ] Canonical valid Strategy plans produce non-empty supported formats for all
      12 weeks.
- [ ] Unknown-only formats fail closed.
- [ ] Generated and revised item versions remain checksum-valid after a real DB
      round-trip and FastAPI validation.
- [ ] Week dates remain exact through all 12 weeks, including Cairo DST.
- [ ] Context cannot change after claim, including cycle-create replay and
      concurrent races.
- [ ] Week 1 is durably queued at cycle creation.
- [ ] Redis failure cannot orphan or skip generation/revision/asset jobs.
- [ ] Bull retries actually perform subsequent provider attempts.
- [ ] Asset-required drafts automatically receive exact-ID asset work.
- [ ] Missing/failed assets block approval; ready verified assets allow it.
- [ ] One exact item version has one terminal decision under sequential and
      concurrent calls.
- [ ] One approved exact version has one candidate and one candidate-created
      event.
- [ ] Pack status is derived in the decision transaction.
- [ ] Candidate events survive Redis, webhook, configuration, and worker-crash
      failures with stable identities.
- [ ] Week 12 completes only after successful draft persistence.
- [ ] Week 13 cannot be generated automatically or manually through this cycle.
- [ ] Real DB/queue/cross-service integration tests cover the lifecycle; the
      mocked controller E2E is not the only evidence.
- [ ] Full verification commands pass and `git diff --check` is clean.
- [ ] Kordy can explain the schedule anchor, context freeze, checksum authority,
      asset identity, decision constraints, transaction boundaries, job outbox,
      and recovery behavior.

## 10. Suggested commit sequence

Keep commits reviewable and traceable to the prior P1 findings:

1. `merge(main): sync publishing and content schema boundaries`
2. `fix(content): map exact strategy-week formats`
3. `fix(content): canonicalize and round-trip item checksums`
4. `fix(content): anchor 12-week schedule and freeze contexts`
5. `feat(content): persist planned assets and queue exact asset work`
6. `feat(content): add durable generation revision and asset job outbox`
7. `fix(content): enforce exact decision and candidate uniqueness`
8. `fix(content): reconcile and atomically claim publication outbox events`
9. `test(content): add real lifecycle concurrency and recovery coverage`

Do not combine all remediation into another very large unreviewable commit.

## 11. Agent handoff report

At completion, report:

- final commit SHA and branch;
- schema/migration summary;
- each prior P1 mapped to the implementing commit and tests;
- exact test commands, totals, and results;
- any intentionally deferred behavior with issue links;
- any environment requirement for PostgreSQL, Redis, shared asset storage, or
  FastAPI;
- confirmation that no GitHub review thread was resolved and no review was
  submitted unless the user explicitly requested those write actions.

Do not claim the owner journey is complete if any required path still relies
only on mocks or manual replay to recover authoritative work.
