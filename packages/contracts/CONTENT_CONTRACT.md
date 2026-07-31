# Content Contract

`content-v1` freezes the Sprint 5A boundary from an exact approved Strategy
version to weekly owner-approved Content items. It is a contracts package only:
no providers, persistence, queues, UI, scheduling, or publishing execution live
here.

## Runtime Boundary

Content starts from:

- one owner-approved Strategy ID and immutable version;
- the matching confirmed Business Profile version;
- one rolling `ContentCycle` for Strategy weeks 1 through 12;
- one `ContentWeekContext` per generated week.

Content may create draft copy, creative briefs, script fields, asset states,
validation issues, and immutable item versions. It cannot change Strategy
decisions, invent live facts, approve itself, schedule posts, publish, or spend
money.

## Weekly Cycle

`ContentCycle.status` is `active`, `paused`, or `completed`. Each cycle uses
`Africa/Cairo`, tracks `current_week_number`, and records the next generation
time. Week numbers are bounded to 1-12. Week 13 requires a new approved
Strategy.

Each `(content_cycle_id, week_number)` has one atomic weekly claim. Duplicate
scheduler/manual/retry claims fail with `CONTENT_WEEK_ALREADY_CLAIMED`.

If owner context is missing before cutoff, the system writes a safe default
context with:

- `promotion_mode: "none"`;
- `promotion: null`;
- `system_defaulted_at`;
- no invented timely facts or expired offers.

## Content Pack And Versions

Each weekly `ContentPack` holds 3-5 intended items in implementation. Contract
examples keep the fixture small, while policy validation enforces exact
Strategy/profile/week/channel and safety invariants.

Every `ContentItemVersion` is immutable and includes:

- channel and format;
- `language_mode` (`ar-EG`, `en`, or `mixed`);
- Strategy week/pillar/channel trace;
- caption variants, CTA, hashtags, creative brief, alt text;
- optional short-video script;
- recommended Cairo publish window;
- claim sources, warnings, blockers;
- asset requirements and asset IDs;
- generation provenance and checksum.

Owner decisions reference one exact item version and checksum. A changed item
requires a new version and a new decision.

## Claim And Asset Policy

The deterministic policy blocks:

- unapproved Strategy versions;
- stale Business Profile versions;
- out-of-range or duplicate weekly claims;
- channels not selected by Strategy;
- invented or expired promotions;
- testimonials, guarantees, price, availability, superiority, branded/sponsored
  disclosure, and competitor-comparison claims without approved evidence;
- protected owner/business text mutation;
- missing ready media for asset-required content;
- empty alt text for image-bearing content, or alt text over 100 characters
  (platform alt-text limit);
- content packs that reference fewer than 3 or more than 5 content items;
- stale approval version/checksum references.

Stable errors are exported from `src/errors/error-codes.ts` and from
`src/content/content-types.ts`.

## Asset Kind And Status Matrix

`ContentAsset.kind` is one of `owner_supplied`, `generated_static`, or
`prompt_only`. `ContentAsset.status` is one of `generating`, `ready`,
`missing`, `failed`, or `blocked`. Kind and status are separate axes: a
`generated_static` asset can be `generating` while the provider renders it and
`ready` only after storage succeeds.

- A required asset must be `ready` before approval or candidate creation;
  `missing`/`failed`/`blocked` produces `CONTENT_ASSET_REQUIRED` or
  `CONTENT_PROVIDER_FAILURE`.
- `prompt_only` assets never satisfy image-bearing content rules and never
  appear in `PublicationCandidateV1`.

## Content Approval vs Publication Approval

**Content approval** is the owner's decision on an exact immutable
`ContentItemVersion`; it is the only thing that can create a
`PublicationCandidateV1`.

**Publication approval** is the separate, later owner decision required before
any real publishing happens. Content never schedules, approves publication,
publishes, or spends money. Candidates carry a recommended publish window only,
never an executed schedule, and publishing automation requires its own explicit
owner approval before delivery.

## PublicationCandidateV1

`PublicationCandidateV1` is the only Sprint 5 handoff to publishing
automation. It contains:

- exact business, Strategy, cycle, pack, item, and item-version identities;
- item-version checksum;
- target channel, format, selected locale;
- approved caption, CTA, hashtags, and alt text;
- ready immutable owner/generated asset references;
- recommended publish window only, not an executed schedule;
- owner content-approval proof;
- candidate state and checksum.

It intentionally excludes prompts, provider internals, raw profile payloads,
target accounts, schedule approval, publish status, and secrets.

Each candidate asset carries an immutable `storage_key` (a content-addressed
object-store reference, not a credential or database pointer). Publishing
automation needs it to fetch the exact bytes for checksum verification before
delivery; it is frozen deliberately and must not be treated as a secret.

The candidate checksum uses `checksum_algorithm: "sha256"` under
`publication-candidate-checksum-v1`: SHA-256 over canonical UTF-8 JSON with
sorted object keys, arrays preserved in semantic order, `undefined` omitted,
`null` preserved, and `candidate_checksum` excluded. Duplicate identical
delivery is idempotent. Same identity with different bytes is
`CONTENT_CANDIDATE_TAMPERED`; revoked candidates are
`CONTENT_CANDIDATE_REVOKED`.

## Allowed Post-Freeze Changes

- Adding new optional fields under a new `contract_version`.
- Fixing documentation or example fixtures that keep the same schema surface.
- Extending validators without changing stable error codes or semantics.

Any change to existing field semantics, removals, or renames follows the
breaking-change process: a new contract version, migration notes, and re-review
by the reviewers in `CONTENT_CONTRACT_REVIEW.md`.

## Review Checklist

The issue-closure review checklist lives in `CONTENT_CONTRACT_REVIEW.md` and
names each reviewer role, the artifact reviewed, the fixture reviewed, the
command evidence, approval status, and date. #107 cannot close until the
checklist entries are confirmed by real human reviews in GitHub.

> This document is product safety guidance, not legal advice. Marketing
> claims, guarantees, and regulated content must still be checked against
> current Egyptian law and platform policies.
