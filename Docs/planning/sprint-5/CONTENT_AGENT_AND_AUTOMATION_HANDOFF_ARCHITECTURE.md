# Content Agent and Publishing-Automation Handoff Architecture

**Status:** approved Sprint 5A implementation plan
**Content epic:** [#106](https://github.com/ARabee3/marketmind-ai/issues/106)
**Contract-freeze issue:** [#107](https://github.com/ARabee3/marketmind-ai/issues/107)
**Content lead:** Merzek (`mostafamerzk`)
**Content team:** Merzek, Mokhtar, and Kordy
**Automation lead:** Ahmed (`ARabee3`)
**Automation team:** Ahmed, Abdulazim, and Gerges

This document explains the approved Content Agent structure and the exact
boundary that lets the Content and publishing-automation teams work in
parallel.

The phase and issue split are approved. Issue #107 remains the required joint
contract-freeze checkpoint. When #107 is accepted, the shared `content-v1` and
`PublicationCandidateV1` shapes become frozen for Sprint 5 implementation.

## 1. Decision summary

The Content Agent turns one exact owner-approved 12-week Strategy version into
a rolling sequence of reviewable weekly content packs.

It generates each week separately:

- 3–5 content items for the current Strategy week;
- captions, CTAs, and hashtags;
- creative briefs and alt text;
- short-video scripts when the format requires them;
- bounded generated-static-image assets when a configured provider is
  available;
- explicit prompt-only, owner-asset, missing-asset, and provider-failure
  states.

The owner reviews and approves exact immutable content-item versions.

Week 1 is generated when the owner starts the approved Strategy Content cycle.
By the end of each active week, the system prepares the next week's draft so
the owner can review it before that week begins. This repeats through Strategy
week 12.

The Content Agent does **not** schedule or publish. After approval, NestJS
creates a small immutable `PublicationCandidateV1` payload. Publishing
automation consumes that payload without reading Content tables, prompts, or
private Business Profile data.

```text
Approved 12-week Strategy version
        |
        v
Create rolling Content cycle
        |
        v
Confirm current/next weekly context
        |
        v
Generate 3–5 items for Strategy week N
        |
        v
Validate and let owner review/revise
        |
        v
Owner approves an exact item version
        |
        v
PublicationCandidateV1
        |
        +---------------------> Publishing automation
        |
        v
At end of week N, prepare week N+1
        |
        v
Repeat through Strategy week 12
```

The weekly sequence is:

```text
Week 1 pack -> Week 2 pack -> ... -> Week 12 pack
     draft        draft                  draft
       |            |                      |
       v            v                      v
 owner review   owner review           owner review
       |            |                      |
       v            v                      v
Publishing automation schedules/exports/publishes safely
```

The only part that must be frozen before both teams implement in parallel is
the shared handoff contract and the small set of identities and states it
depends on. Internal prompts, page layouts, database implementation details,
and provider code do not need to be frozen.

## 2. MVP boundary

### Required now

- One rolling Content cycle covering Strategy weeks 1–12.
- One separate immutable `ContentPack` per Strategy week.
- Initial Week 1 generation after the Strategy Content cycle starts.
- Automatic preparation of week N+1 by the end of active week N.
- 3–5 content items per week derived from that Strategy week's theme, cadence,
  experiments, and capacity.
- Owner-editable next-week context before its generation cutoff.
- Safe no-promotion defaults when optional next-week context is not supplied.
- Only Strategy-selected channels and compatible formats.
- Arabic, English, and mixed-language output according to the approved
  Strategy and owner context.
- Immutable item versions.
- Item-level approve, reject, and revision-requested decisions.
- Explicit bulk approval of selected eligible item versions.
- Static-image generation behind a replaceable provider adapter.
- Owner-supplied and prompt-only asset fallbacks.
- One stable automation handoff for every approved publication-ready item.
- Visible provider, validation, asset, queue, and handoff failures.

### Deferred

- Content beyond the approved Strategy's 12-week horizon.
- Generating week 13 without a newly approved or explicitly extended Strategy.
- Full generated video.
- Automatic carousel rendering.
- Advanced image or video editing.
- Live web or competitor research inside Content.
- Social-account connection.
- Schedule execution and publishing.
- Metrics, monitoring, optimization, and paid-ad execution.

## 3. Responsibility boundaries

| Layer | Responsibility |
| --- | --- |
| Next.js Web | Rolling 12-week Content cycle, weekly context/cutoff, current/next-week readiness, real progress, editorial review, asset states, revision feedback, exact-version decisions, and history |
| NestJS API | Auth/ownership, approved-Strategy checks, weekly scheduler, queueing, persistence, immutable versions, deterministic policy, assets, decisions, retries, and automation handoff |
| FastAPI AI | Structured draft generation, item revision, prompt assembly, provider adapters, bounded repair, static-image generation, and AI-focused validation |
| PostgreSQL | Authoritative Content packs, contexts, items, versions, assets, decisions, generation runs, progress, and outbox records |
| Redis/BullMQ | Asynchronous Content generation and revision jobs |
| Asset storage port | Immutable media bytes plus checksums; local/test and deployed drivers may differ |
| Publishing automation | Consume approved candidates, connect targets, choose/confirm schedules, export or publish, and report deterministic results |

### Important ownership rules

- PostgreSQL remains authoritative for approval and version state.
- The complete confirmed Business Profile is passed directly to generation. It
  is not copied into the publishing handoff.
- FastAPI cannot approve content.
- The Content Web page cannot fabricate readiness, progress, or success.
- Publishing automation cannot query Content internals to find something to
  publish.
- An outbox delivery means “an approved candidate is available.” It does not
  mean “publishing succeeded.”

## 4. Required generation inputs

Content generation receives four separate inputs.

### 4.1 Exact approved Strategy

NestJS supplies:

- Strategy ID;
- exact immutable Strategy version;
- Strategy owner-decision reference;
- selected channels;
- the requested week's number, theme, formats, experiments, and cadence;
- content pillars;
- tone and language mode;
- cadence and capacity constraints;
- relevant experiments, risks, assumptions, and blockers.

Content must not read a floating `latest` Strategy draft. The exact version is
part of every Content identity.

### 4.2 Matching confirmed Business Profile

NestJS supplies the complete confirmed profile version referenced by the
Strategy.

It remains the source for facts such as:

- business name and description;
- location and contact details;
- products or services;
- target customers;
- brand voice and restrictions;
- confirmed social handles and links;
- known operational constraints.

If the profile no longer matches the approved Strategy, generation fails with
`CONTENT_PROFILE_STALE`. The model must not decide that the mismatch is safe.

### 4.3 Owner-confirmed weekly context

Each weekly context adds timely owner input without changing the approved
Strategy. The owner may update next week's context until its generation job
claims the week.

Proposed shape:

```ts
interface ContentWeekContext {
  id: UUID;
  content_cycle_id: UUID;
  week_number: number; // integer 1–12
  week_start_date: IsoDate;

  promotion_mode: "none" | "owner_approved";
  promotion: {
    text: string;
    terms: string[];
    valid_from: IsoDate;
    valid_until: IsoDate;
  } | null;

  must_include: string[];
  must_avoid: string[];
  approved_asset_ids: UUID[];

  cta_destination: {
    type: "phone" | "whatsapp" | "website" | "address" | "none";
    value: string | null;
  };

  confirmed_by_user_id: UUID;
  confirmed_at: IsoDateTime;
}
```

The explicit `promotion_mode` matters. If the owner chooses `none`, the model
cannot invent a discount or offer because it thinks the post needs one.

If the next week's optional context is not confirmed before the generation
cutoff, the system creates a safe context with:

- `promotion_mode: "none"`;
- no must-include instructions;
- inherited approved brand restrictions and reusable approved assets only;
- a CTA destination selected from already confirmed business data;
- a visible `system_defaulted_at`/default-context indicator in the persisted
  contract.

The system never carries an expiring offer, date-sensitive statement, or
unconfirmed operational fact into the next week automatically.

### 4.3.1 Where owner media, offers, and live events go

All owner-supplied "what's new this week" input enters through the weekly
context (§4.3), never the Strategy or Discovery facts:

| Owner input (example: perfume shop) | Weekly-context field | Notes |
| --- | --- | --- |
| Product / brand photos | `approved_asset_ids` | Uploaded via Content API, resolved to `owner_supplied` assets (§5.4) |
| New offer / discount | `promotion` + `promotion_mode: "owner_approved"` | Terms, valid dates, text |
| Live event (in-store demo) | `must_include` | Optional CTA + photo via the same fields |
| What not to say / show | `must_avoid` | e.g. "no 'free shipping'" |
| Where the post must send the reader | `cta_destination` | phone / whatsapp / website / address |

- A weekly context with no promotion stays `promotion_mode: "none"`; the model
  never invents an offer or carries an expired one forward (§4.3 safety).
- A product catalog (name/price/category per product) is **post-MVP**. Until it
  exists, products travel as photos + `must_include` + optional `promotion`.
- Not built in this sprint: the asset upload endpoints (#110) and the
  "what's happening this week?" form (#111). Until those land, the weekly
  context is API/persisted-data only.

### 4.4 Approved assets and brand restrictions

Generation may receive:

- owner-uploaded logo or product photos;
- approved generated assets from earlier attempts;
- brand colors and usage restrictions;
- prohibited claims or visual treatments;
- asset rights/ownership metadata where available.

Missing required media becomes a visible asset state or blocker. It never
becomes an invented successful asset.

## 5. Proposed core Content model

The exact field names are finalized in #107, but the separation below is a
required architectural decision.

### 5.1 Content cycle

A `ContentCycle` groups the rolling weekly packs for one exact approved
Strategy version.

```ts
interface ContentCycle {
  id: UUID;
  contract_version: "content-v1";

  business_id: UUID;
  strategy_id: UUID;
  strategy_version: number;
  strategy_decision_id: UUID;
  profile_version_id: UUID;

  status: "active" | "paused" | "completed";
  current_week_number: number; // integer 1–12
  next_generation_at: IsoDateTime | null;
  timezone: "Africa/Cairo";

  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
```

A new approved Strategy version creates a new Content cycle. It pauses future
generation for the old cycle; it does not rewrite previously approved or
published weekly packs.

### 5.2 Content pack

A `ContentPack` is one weekly generation/review container tied to one Content
cycle, one Strategy week from 1 through 12, and one confirmed or safely
defaulted weekly context.

```ts
interface ContentPack {
  id: UUID;
  contract_version: "content-v1";

  content_cycle_id: UUID;
  week_number: number; // integer 1–12
  business_id: UUID;
  strategy_id: UUID;
  strategy_version: number;
  strategy_decision_id: UUID;
  profile_version_id: UUID;
  week_context_id: UUID;

  status: ContentPackStatus;
  item_ids: UUID[];

  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
```

The database enforces one active weekly pack identity per
`(content_cycle_id, week_number)`. Scheduler retries cannot create duplicate
week packs.

### 5.3 Content item and immutable item version

The stable item identity and its versions remain separate.

```ts
interface ContentItem {
  id: UUID;
  content_pack_id: UUID;
  current_version_id: UUID;
  created_at: IsoDateTime;
}

interface ContentItemVersion {
  id: UUID;
  content_item_id: UUID;
  version: number;

  channel: ContentChannel;
  format: ContentFormat;
  language_mode: "ar" | "en" | "mixed";

  strategy_trace: {
    week_number: number; // integer 1–12
    pillar_ids: UUID[];
    objective: string;
    channel: ContentChannel;
  };

  caption_variants: Array<{
    locale: "ar" | "en";
    caption: string;
    cta: string | null;
    hashtags: string[];
  }>;

  creative: {
    brief: string;
    alt_text: string;
    asset_required: boolean;
    asset_ids: UUID[];
  };

  short_video_script: {
    hook: string;
    scenes: Array<{
      order: number;
      visual_direction: string;
      voiceover: string | null;
      on_screen_text: string | null;
    }>;
    closing_cta: string | null;
  } | null;

  recommended_publish_window: {
    starts_at: IsoDateTime;
    ends_at: IsoDateTime;
    timezone: "Africa/Cairo";
  };

  claim_sources: ContentClaimSource[];
  warnings: ContentValidationIssue[];
  blockers: ContentValidationIssue[];
  generation_provenance: ContentGenerationProvenance;
  checksum: string;
  created_at: IsoDateTime;
}
```

`claim_sources` should identify whether an important claim came from:

- a confirmed Business Profile field;
- an explicit or safely defaulted weekly owner-context field;
- an approved Strategy field.

It must never cite “model knowledge” as a confirmed business fact.

### 5.4 Asset model

Asset identity, storage, and readiness remain separate from generated copy.

```ts
interface ContentAsset {
  id: UUID;
  content_item_version_id: UUID;

  kind:
    | "owner_supplied"
    | "generated_static"
    | "prompt_only";

  status:
    | "generating"
    | "ready"
    | "missing"
    | "failed"
    | "blocked";

  mime_type: string | null;
  width: number | null;
  height: number | null;
  storage_key: string | null;
  checksum: string | null;
  alt_text: string;

  provider_name: string | null;
  provider_model: string | null;
  provider_request_id: string | null;
  failure_code: string | null;

  created_at: IsoDateTime;
}
```

An expiring public provider URL must not be the authoritative asset reference.
The authoritative record uses an immutable asset ID, storage key, and checksum.

### 5.5 Owner decision

Every decision references an exact immutable item version.

```ts
interface ContentDecision {
  id: UUID;
  content_item_id: UUID;
  content_item_version_id: UUID;
  content_item_version: number;

  decision:
    | "approved"
    | "rejected"
    | "revision_requested";

  revision_notes: string | null;
  decided_by_user_id: UUID;
  decided_at: IsoDateTime;
}
```

Repeated requests with the same idempotency key return the original result.
They do not create another decision.

An approved item version is immutable and terminal for Content v1. Changing
approved publishable copy or assets requires a new version and a new approval;
the automation track must explicitly cancel or replace any earlier schedule.

## 6. Lifecycle

### 6.1 Content-cycle lifecycle

```text
active -> paused -> active
active -> completed
```

An active cycle:

1. creates Week 1 when the owner starts Content from the approved Strategy;
2. calculates the next weekly generation cutoff in `Africa/Cairo`;
3. accepts next-week context changes until that cutoff;
4. atomically claims week N+1 at the cutoff;
5. creates at most one pack for that cycle/week;
6. repeats until Week 12 completes.

The default cutoff is the end of the current Strategy week so the next draft is
available before the next week begins. The exact clock time is configuration,
not an LLM decision.

The cycle pauses when:

- the owner explicitly pauses future generation;
- the profile becomes stale relative to Strategy;
- a new Strategy version supersedes the cycle;
- a required system dependency has a non-retryable failure.

It completes after Week 12. It never creates Week 13 automatically.

Automatic weekly generation creates a **draft only**. It never approves,
schedules, or publishes the result.

### 6.2 Pack lifecycle

The approved pack lifecycle is:

```text
queued
  -> generating
  -> validating
  -> draft
  -> partially_approved
  -> approved
```

Failure behavior:

```text
queued | generating | validating -> failed
failed -> queued  (eligible explicit retry only)
```

Pack approval state is derived from the current item decisions:

- `draft`: no current item version is approved;
- `partially_approved`: at least one current version is approved and at least
  one selected item still needs a decision;
- `approved`: every included publication item has an approved eligible current
  version.

There is no LLM-generated pack approval.

### 6.3 Item revision lifecycle

```text
draft version
  -> revision_requested
  -> revising
  -> new draft version
```

Failure behavior:

```text
revising -> revision_failed
```

A failed revision keeps the previous draft readable and reviewable.

Decision behavior:

```text
draft version -> approved
draft version -> rejected
```

Approval is blocked when:

- the Strategy or profile version does not match;
- the item uses a non-selected channel;
- an important claim has no approved source;
- a promotion was not explicitly owner-approved;
- a required asset is not ready;
- a safety or regulated-claim blocker exists;
- the client submits a stale item version;
- the checksum no longer matches.

## 7. PublicationCandidateV1

`PublicationCandidateV1` is the frozen boundary between the two teams.

It represents one exact, approved, publication-ready Content item version. It
does not represent a schedule or a successful publication.

### 7.1 Proposed payload

```ts
interface PublicationCandidateV1 {
  contract_version: "publication-candidate-v1";
  candidate_id: UUID;

  business_id: UUID;
  strategy_id: UUID;
  strategy_version: number;
  content_cycle_id: UUID;
  strategy_week_number: number; // integer 1–12
  content_pack_id: UUID;
  content_item_id: UUID;
  content_item_version_id: UUID;
  content_item_version: number;

  target_channel: ContentChannel;
  content_format: ContentFormat;
  selected_locale: "ar" | "en";

  caption: string;
  cta: string | null;
  hashtags: string[];
  alt_text: string;

  assets: Array<{
    asset_id: UUID;
    kind: "owner_supplied" | "generated_static";
    mime_type: string;
    checksum: string;
  }>;

  recommended_publish_window: {
    starts_at: IsoDateTime;
    ends_at: IsoDateTime;
    timezone: "Africa/Cairo";
  };

  approval: {
    decision_id: UUID;
    decided_by_user_id: UUID;
    decided_at: IsoDateTime;
  };

  candidate_checksum: string;
  created_at: IsoDateTime;
}
```

### 7.2 What the payload intentionally excludes

- AI prompts and raw provider responses;
- complete Business Profile data;
- private Strategy retrieval packs;
- provider API keys or asset-storage credentials;
- mutable database object references such as `currentVersionId`;
- an actual publishing time chosen without owner confirmation;
- platform tokens or connected-account identifiers;
- claims that the item was scheduled or published.

### 7.3 Event envelope

The outbox may publish the candidate inside a versioned event:

```ts
interface PublicationCandidateCreatedEventV1 {
  event_id: UUID;
  event_type: "content.publication_candidate.created.v1";
  occurred_at: IsoDateTime;
  correlation_id: UUID;
  payload: PublicationCandidateV1;
}
```

Delivery is at least once. The automation consumer must deduplicate by
`event_id` and `candidate_id`, then verify `candidate_checksum`.

Candidate state is not part of the immutable candidate payload. Content stores
and exposes a separate `PublicationCandidateStatusV1` bound to the exact
`candidate_id` and `candidate_checksum`. Revocation or replacement emits a
versioned `content.publication_candidate.state_changed.v1` outbox event with a
monotonic `state_version`; it never mutates the original candidate bytes.
Automation deduplicates the state event, rejects a status/checksum mismatch,
and cancels a not-yet-dispatched intent for a matching `revoked` or `replaced`
status.

## 8. Producer and consumer responsibilities

### Content producer guarantees

Before emitting a candidate, Content guarantees:

- the Strategy version has an explicit owner-approved decision;
- the Business Profile version matches the Strategy;
- the item version is immutable and explicitly approved;
- every required asset is ready and checksum-addressed;
- no deterministic blocker remains;
- the candidate checksum covers all publishable fields;
- the candidate is persisted before outbox delivery;
- retrying outbox delivery does not create a new candidate.

### Automation consumer guarantees

Before scheduling/exporting/publishing, automation guarantees:

- the contract version is supported;
- the event and candidate have not already been processed;
- the checksum is valid;
- the exact candidate is still active and not cancelled/replaced;
- the chosen channel has a connected, authorized target;
- required media can be retrieved and its checksum matches;
- the owner explicitly approves the actual schedule/publishing attempt when
  required by the publishing workflow;
- a failure is recorded and shown rather than converted into simulated
  success.

Automation must never “repair” an invalid candidate by changing its caption,
asset, channel, or approval data. It rejects the candidate and reports a
contract/policy error to Content.

## 9. Proposed interfaces

The final route names and DTOs are frozen in #107.

### 9.1 Public NestJS API intent

```text
POST /api/v1/content-cycles
GET  /api/v1/content-cycles/:id
POST /api/v1/content-cycles/:id/pause
POST /api/v1/content-cycles/:id/resume

GET  /api/v1/content-cycles/:id/weeks
PUT  /api/v1/content-cycles/:id/weeks/:week_number/context
POST /api/v1/content-cycles/:id/weeks/:week_number/generate

GET  /api/v1/content-packs/:id
GET  /api/v1/content-packs/:id/progress
POST /api/v1/content-packs/:id/retry

GET  /api/v1/content-packs/:id/items/:item_id/versions
POST /api/v1/content-packs/:id/items/:item_id/decisions
POST /api/v1/content-packs/:id/decisions/bulk

GET  /api/v1/content-assets/:asset_id
GET  /api/v1/publication-candidates/:candidate_id
```

`POST /content-cycles` includes:

- exact Strategy ID and version;
- idempotency key;
- complete confirmed initial-week context.

The scheduler and explicit generate endpoint share one atomic weekly claim. A
manual request cannot create a duplicate pack if the scheduler has already
claimed that cycle/week.

The server rechecks Strategy approval, profile match, ownership, and readiness.
It does not trust a client-supplied `approved: true`.

### 9.2 Internal FastAPI intent

```text
POST /internal/v1/ai/content/generate
POST /internal/v1/ai/content/revise
POST /internal/v1/ai/content/assets/generate-static
```

FastAPI returns contract-shaped draft data plus validation results. NestJS
reruns authoritative cross-object validation before persistence.

### 9.3 Progress

The status endpoint is canonical. A WebSocket/SSE transport may be added if it
fits the existing project pattern, but Web must recover by reading current
server state. No UI may use a fake timer as lifecycle truth.

## 10. Deterministic validation and safety

The LLM may write and revise content, but deterministic code owns these rules:

- exact Strategy approval and version;
- exact confirmed profile version;
- requested Strategy week is an integer from 1 through 12;
- the requested week has not already been claimed/generated for the cycle;
- weekly item count of 3–5;
- selected channels and supported formats;
- Strategy pillar, experiment, and requested-week trace;
- safe weekly-context default/cutoff behavior;
- promotion mode and validity;
- claim source eligibility;
- regulated-claim and prohibited-language blockers;
- required asset readiness;
- immutable version and decision conflicts;
- approval eligibility;
- candidate checksum.

Stable errors should include:

```text
CONTENT_STRATEGY_NOT_APPROVED
CONTENT_PROFILE_STALE
CONTENT_CYCLE_PAUSED
CONTENT_CYCLE_COMPLETED
CONTENT_WEEK_OUT_OF_RANGE
CONTENT_WEEK_ALREADY_CLAIMED
CONTENT_CHANNEL_MISMATCH
CONTENT_UNSUPPORTED_CLAIM
CONTENT_OFFER_UNAPPROVED
CONTENT_POLICY_VIOLATION
CONTENT_ASSET_REQUIRED
CONTENT_SCHEMA_FAILURE
CONTENT_VERSION_CONFLICT
CONTENT_APPROVAL_BLOCKED
CONTENT_PROVIDER_FAILURE
```

Every error includes a stable code, safe message, relevant field path, and
retry eligibility where applicable.

## 11. Persistence outline

The final Prisma names may differ, but PostgreSQL should keep these concepts
separate:

```text
content_cycles
content_packs
content_week_contexts
content_items
content_item_versions
content_assets
content_generation_runs
content_progress_events
content_decisions
publication_candidates
publication_candidate_outbox
```

Important invariants:

- one Content cycle belongs to one exact approved Strategy version;
- one active pack identity exists per `(content_cycle_id, week_number)`;
- scheduler/manual retries use the same atomic weekly claim and idempotency
  identity;
- Week 13 cannot be created without a new approved Strategy/contract action;
- item versions are insert-only;
- decisions reference exact item versions;
- candidates reference exact approved decisions and item versions;
- candidate/outbox creation occurs in one authoritative transaction;
- outbox retries do not create duplicate candidates;
- media bytes are stored through an asset-storage port, not inside general JSON
  plan columns;
- prior drafts and approved candidates remain readable during provider outage.

## 12. Contract freeze process

“Freeze” means locking the shared agreement, not stopping all development.

### 12.1 Freeze checklist

Issue #107 closes only after:

1. TypeScript `content-v1` types are reviewed.
2. Pydantic mirrors accept/reject the same fixtures.
3. `ContentCycle`, weekly pack identity, cutoff, safe-default context, pause,
   completion, and exactly-once weekly claim rules are executable.
4. Valid Week 1, Week 2 rollover, and approved `PublicationCandidateV1`
   fixtures exist.
5. Invalid unapproved, stale, duplicate-week, Week 13, missing-asset, and
   tampered fixtures exist.
6. Content API, AI, Web, and automation owners review the contract.
7. Automation proves it can validate the candidate fixture without running
   Content.
8. Snapshot/parity tests pass in the normal repository checks.

### 12.2 Allowed after the freeze

- documentation clarification;
- more examples;
- validator bug fixes that enforce the documented meaning;
- implementation changes behind the same wire contract;
- new optional fields only when all consumers safely ignore or default them;
- performance, logging, and test improvements.

### 12.3 Not allowed without coordinated versioning

- removing or renaming a field;
- changing a field type;
- changing the meaning of approval, checksum, identity, or lifecycle state;
- changing an optional field to required;
- changing an enum value used by another team;
- adding publishing authority to Content;
- allowing automation to bypass an approval or asset requirement.

### 12.4 Breaking-change procedure

If a breaking change is genuinely necessary:

1. Open a contract-change issue and describe the concrete failure.
2. Get approval from the Content and automation leads plus affected consumers.
3. Add a new version such as `publication-candidate-v2`.
4. Keep V1 working while consumers migrate.
5. Add V1-to-V2 compatibility/rejection tests.
6. Remove V1 only after every consumer has migrated and the removal is
   explicitly approved.

## 13. Parallel team plan

### Content team

| Owner | Medium issue | Large issue |
| --- | --- | --- |
| Merzek | [#107 — contracts and handoff](https://github.com/ARabee3/marketmind-ai/issues/107) | [#111 — Content Web workspace](https://github.com/ARabee3/marketmind-ai/issues/111) |
| Mokhtar | [#109 — evaluation](https://github.com/ARabee3/marketmind-ai/issues/109) | [#108 — generation and revision](https://github.com/ARabee3/marketmind-ai/issues/108) |
| Kordy | [#112 — integration](https://github.com/ARabee3/marketmind-ai/issues/112) | [#110 — API lifecycle](https://github.com/ARabee3/marketmind-ai/issues/110) |

### Dependency order

```text
#107 contract
  |---> #108 AI generation ----> #109 evaluation
  |---> #110 API lifecycle
  |---> #111 Web against contract mocks
                       |
                       v
                 #112 integration
```

### Automation start point

The automation team does not wait for #108–#112.

It starts after #107 provides:

- the frozen event/payload types;
- a valid approved-candidate fixture;
- invalid unapproved/tampered fixtures;
- checksum rules;
- asset retrieval expectations;
- idempotency expectations.

This is the practical value of the freeze: each team can build its own internals
while sharing one stable boundary.

## 14. Failure and recovery rules

| Failure | Required behavior |
| --- | --- |
| Strategy is not approved | Block generation; do not call the provider |
| Profile version is stale | Block and ask the owner to return to Strategy/profile review |
| Next-week context is absent | Use explicit safe no-promotion defaults; do not invent timely facts |
| Scheduler and owner trigger the same week | One atomic claim wins; both resolve to the same pack/run |
| A week is already generated | Return the existing pack; do not create a duplicate |
| A new Strategy supersedes the cycle | Pause future old-cycle generation; preserve prior weekly packs |
| Week 12 completes | Mark the cycle completed; never generate Week 13 automatically |
| Provider times out | Mark retryable failure; do not persist a fake draft |
| Provider output is invalid | Apply bounded repair, then fail visibly |
| Unsupported claim/offer | Block the affected item from approval |
| Image provider fails | Keep prompt/brief and show failed or prompt-only state |
| Required asset is missing | Block publication-candidate creation |
| Revision fails | Preserve the previous item version |
| Duplicate generation click | Return the original run/idempotent result |
| Stale decision | Reject with version conflict; preserve current state |
| Outbox delivery retries | Reuse the same candidate and event identity |
| Automation rejects candidate | Record handoff error; do not mutate the approved item |

## 15. Definition of Done

The Content Agent is complete only when:

- an exact approved Strategy version creates one rolling Content cycle;
- Week 1 can be generated when that cycle starts;
- by the end of active week N, week N+1 is generated exactly once through Week
  12;
- absent optional next-week context uses visible safe defaults and never carries
  an expired offer;
- no cycle automatically generates Week 13;
- every weekly pack contains 3–5 valid items aligned to that Strategy week;
- required captions, CTAs, hashtags, creative briefs, alt text, scripts, and
  asset states are present;
- unsupported claims, offers, channels, and regulated claims are blocked;
- Arabic, English, and mixed-language content preserve protected owner/business
  text;
- item revision creates immutable versions and failed revision preserves the
  prior version;
- exact-version individual and bulk decisions are idempotent;
- only eligible approved item versions create candidates;
- automation accepts the valid frozen fixture and rejects unapproved or
  tampered fixtures;
- all provider, asset, queue, validation, and handoff failures are visible;
- at least 15 reviewed Content evaluation cases meet the issue #109
  thresholds;
- `npm run check` and affected service/browser tests pass;
- the team can demo and explain approved Strategy → rolling weekly draft →
  revision → owner approval → automation handoff → next-week draft without
  claiming that publication already happened.

## 16. First joint checkpoint

Before implementation branches diverge, both teams should meet for one short
checkpoint and confirm:

1. exact `PublicationCandidateV1` fields;
2. content/item/version/decision identities;
3. checksum inputs;
4. asset retrieval and checksum behavior;
5. event idempotency and replay behavior;
6. cancellation/replacement ownership;
7. the valid and invalid shared fixtures;
8. weekly cutoff, safe-default, and scheduler idempotency behavior;
9. who approves a future breaking contract change.

After this checkpoint and #107 acceptance, each team can implement independently
against the frozen V1 boundary.

The approved downstream lifecycle, safety rules, and Automation-team
issue split are documented in `PUBLISHING_AUTOMATION_ARCHITECTURE.md`.
