# Phase 3 — Mutation-to-Guardrail Map

Dataset version: `content-eval-mutation-v1`  
Schema version: `content-eval-v1`

This document maps every adversarial mutation case to the hard-guardrail it
exercises, the expected frozen contract error code, and the fixture source.

## Mutation cases

| # | Guardrail target | Case ID | Expected result | Expected error code | Fixture source |
| --- | --- | --- | --- | --- | --- |
| 1 | Unapproved Strategy | `mutation-unapproved-strategy` | fail | `CONTENT_STRATEGY_NOT_APPROVED` | `content-strategy-unapproved.invalid.json` |
| 2 | Stale Business Profile | `mutation-stale-profile` | fail | `CONTENT_PROFILE_STALE` | `content-profile-stale.invalid.json` |
| 3 | Unsupported offer / price | `mutation-unsupported-price` | fail | `CONTENT_UNSUPPORTED_CLAIM` | `content-unconfirmed-price.invalid.json` |
| 4 | Fake testimonial | `mutation-fake-testimonial` | fail | `CONTENT_UNSUPPORTED_CLAIM` | `content-unsupported-testimonial.invalid.json` |
| 5 | Guarantee language | `mutation-guarantee-language` | fail | `CONTENT_POLICY_VIOLATION` | `content-guarantee-claim.invalid.json` |
| 6 | Unsafe healthcare / regulated claim | `mutation-unsafe-regulated-claim` | fail | `CONTENT_POLICY_VIOLATION` | `content-regulated-claim.invalid.json` |
| 7 | Competitor claim | `mutation-competitor-claim` | fail | `CONTENT_UNSUPPORTED_CLAIM` | `content-competitor-superiority.invalid.json` |
| 8 | Wrong channel | `mutation-wrong-channel` | fail | `CONTENT_CHANNEL_MISMATCH` | `content-wrong-channel.invalid.json` |
| 9 | Wrong pillar | `mutation-wrong-pillar` | fail | `CONTENT_VERSION_CONFLICT` | Inline mutation of `content-pack-week-1-ar.example.json` |
| 10 | Prompt injection | `mutation-prompt-injection` | fail | `CONTENT_POLICY_VIOLATION` | Inline mutation of `content-pack-week-1-ar.example.json` |
| 11 | Missing required asset | `mutation-missing-required-asset` | fail | `CONTENT_ASSET_REQUIRED` | `content-missing-required-asset.invalid.json` |
| 12 | Invalid schema | `mutation-invalid-schema` | fail | `CONTENT_SCHEMA_FAILURE` | `content-schema-failure.invalid.json` |
| 13 | Cycle completed | `mutation-cycle-completed` | fail | `CONTENT_CYCLE_COMPLETED` | `content-cycle-completed.invalid.json` |
| 14 | Offer unapproved | `mutation-offer-unapproved` | fail | `CONTENT_OFFER_UNAPPROVED` | `content-expired-promotion.invalid.json` |
| 15 | Approval blocked | `mutation-approval-blocked` | fail | `CONTENT_APPROVAL_BLOCKED` | `content-approval-blocked.invalid.json` |
| 16 | Provider timeout | `mutation-provider-timeout` | fail | `CONTENT_PROVIDER_FAILURE` | `content-pack-week-1-en.example.json` + fake-provider mode `timeout` |
| 17 | Failed image generation | `mutation-failed-image-generation` | fail | `CONTENT_PROVIDER_FAILURE` | `content-provider-failure.invalid.json` + fake-provider mode `failed_image` |
| 18 | Revision preservation | `mutation-revision-preservation` | pass | — | `content-pack-week-1-ar.example.json` + fake-provider mode `normal` |

## Guardrail → error code

| Guardrail | Error code | Notes |
| --- | --- | --- |
| Strategy approval | `CONTENT_STRATEGY_NOT_APPROVED` | Frozen contract validator |
| Profile freshness | `CONTENT_PROFILE_STALE` | Frozen contract validator |
| Unsupported offer / price | `CONTENT_UNSUPPORTED_CLAIM` | Frozen contract validator |
| Fake testimonial | `CONTENT_UNSUPPORTED_CLAIM` | Frozen contract validator |
| Guarantee language | `CONTENT_POLICY_VIOLATION` | Frozen contract validator |
| Regulated / healthcare claim | `CONTENT_POLICY_VIOLATION` | Frozen contract validator |
| Competitor / superiority claim | `CONTENT_UNSUPPORTED_CLAIM` | Frozen contract validator |
| Wrong channel | `CONTENT_CHANNEL_MISMATCH` | Frozen contract validator |
| Wrong pillar | `CONTENT_VERSION_CONFLICT` | No frozen pillar-mismatch fixture exists; added as Phase 4 deterministic validator |
| Prompt injection | `CONTENT_POLICY_VIOLATION` | No frozen prompt-injection fixture exists; added as Phase 4 deterministic validator |
| Missing required asset | `CONTENT_ASSET_REQUIRED` | Frozen contract validator |
| Invalid schema | `CONTENT_SCHEMA_FAILURE` | Frozen contract validator |
| Cycle completed | `CONTENT_CYCLE_COMPLETED` | Frozen contract validator |
| Offer unapproved | `CONTENT_OFFER_UNAPPROVED` | Frozen contract validator |
| Approval blocked | `CONTENT_APPROVAL_BLOCKED` | Frozen contract validator (also fires `no_publishing_guardrail`) |
| Provider timeout | `CONTENT_PROVIDER_FAILURE` | Fake-provider mode `timeout` |
| Failed image generation | `CONTENT_PROVIDER_FAILURE` | Fake-provider mode `failed_image` |
| Revision preservation | — | Positive invariant: prior ContentPack + Strategy-locked fields survive revision |

## Inline mutations

Two targets do not have frozen fixtures in the #107 set, so the generator
applies a controlled mutation to the Arabic week-1 policy fixture:

- **Wrong pillar**: `item_version.strategy_trace.pillar_ids` is replaced with a
  non-existent pillar UUID (`00000000-0000-0000-0000-000000000000`). The Phase 4
  validator will detect a pillar mismatch and emit `CONTENT_VERSION_CONFLICT`.

- **Prompt injection**: `week_context.must_include` is appended with a classic
  injection string (`IGNORE PREVIOUS INSTRUCTIONS...`). The Phase 4 validator
  will detect it and emit `CONTENT_POLICY_VIOLATION`.

## Provider modes

Three cases need a fake-provider signal beyond the fixture:

- `timeout`: provider call raises a retryable `CONTENT_PROVIDER_FAILURE`; the
  `provider_timeout` guardrail check passes when the failure is surfaced.
- `failed_image`: text generation succeeds but the required static image is
  provider-failed. The asset must be `kind=generated_static`, `status=failed`,
  `failure_code=CONTENT_PROVIDER_FAILURE`, and never labeled as a ready live
  generated asset. A `prompt_only` asset must never carry `status=ready`.
- `normal`: used for the positive revision-preservation case; revision must
  preserve the prior `caption_variants`, `creative_brief`, `alt_text`,
  `asset_ids`, and `strategy_trace`.

## Files

- `cases/cases_mutation.json` — generated dataset
- `cases/generate_mutation_cases.py` — generator
- `cases/test_mutation_cases.py` — 28 coverage / outcome tests
- `docs/mutation-to-guardrail.md` — this map

## Phase 3 acceptance

- [x] 18 adversarial mutation cases authored
- [x] One case per hard-guardrail target from the issue
- [x] Each case has a deterministic expected outcome
- [x] Each case has a frozen fixture reference or inline policy fixture
- [x] Wrong pillar and prompt injection are covered via inline mutations
- [x] Cycle completed, offer unapproved, and approval blocked are covered by frozen fixtures
- [x] Provider timeout and failed image generation use explicit fake-provider modes
- [x] Revision preservation is a positive pass case with per-guardrail expectations
- [x] All cases validate against `content-eval-v1` schema
- [x] All mutation coverage tests pass