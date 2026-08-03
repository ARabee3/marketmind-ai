# Content Evaluation Case Schema Reference

Version: `content-eval-v1`

This document describes the immutable evaluation-case format used by the
Content evaluation harness under
``services/ai/tests/evaluation/content/``. Each case is a Pydantic ``FrozenModel``
so the dataset cannot be mutated after sign-off.

## Top-level dataset

``ContentEvalDataset``:

| Field | Type | Notes |
| --- | --- | --- |
| `version` | `str` | Dataset revision, independent of `schema_version`. |
| `schema_version` | `Literal["content-eval-v1"]` | Frozen case format version. |
| `cases` | `list[ContentEvalCase]` | The actual cases. |
| `created_at` | `str` | ISO timestamp when the dataset was first authored. |
| `updated_at` | `str | None` | Last modification timestamp (optional). |

## Case model

``ContentEvalCase``:

| Field | Type | Notes |
| --- | --- | --- |
| `case_id` | `str` | Stable, unique within the dataset. |
| `schema_version` | `Literal["content-eval-v1"]` | Lets old cases keep validating if the format evolves. |
| `sector` | `Literal["hospitality","retail","services","education","healthcare"]` | Business sector being tested. |
| `language_mode` | `Literal["ar","en","mixed"]` | Eval shorthand; `ar` maps to contract `ar-EG`. |
| `strategy_snapshot` | `StrategySnapshot` | Approved channels, pillars, tone, formats, content count, fact sources, owner inputs. |
| `cycle_state` | `CycleState` | `content_cycle_id`, `week_number`, prior pack reference, optional next-week context or explicit absence flag. |
| `protected_fictional_fields` | `ProtectedFictionalFields` | Synthetic business data: names, handles, addresses, prices, offer terms, owner text. |
| `expected_hard_outcome` | `ExpectedHardOutcome` | Per-guardrail pass/fail plus the exact `ContentErrorCode` set expected. |
| `failure_category` | `FailureCategory` | High-level tag used for the coverage matrix and mutation map. |
| `human_rubric` | `HumanRubric` | Scored 0–5 by named human reviewers; the model never scores itself. |
| `reviewers` | `ReviewerSignOffs` | Four named slots with per-case `signed_off`/`signed_at`/`notes`. |
| `description` | `str` | What this case exercises and why it exists. |
| `fixture_ref` | `str | None` | Relative path to a frozen #107 fixture file (preferred). |
| `policy_fixture` | `ContentPolicyFixture | None` | Inline fixture for cases not covered by the frozen fixture set. |
| `provider_mode` | `Literal["normal","timeout","failed_image"] | None` | Optional fake-provider mode used by the runner for provider-timeout / failed-image mutation cases. |
| `created_at` | `str` | Case authorship timestamp. |
| `updated_at` | `str | None` | Last edit timestamp. |

At least one of `fixture_ref` or `policy_fixture` must be present.

## Sub-models

### StrategySnapshot

| Field | Type | Constraints |
| --- | --- | --- |
| `approved_channels` | `list[ContentChannel]` | `min_length=1` |
| `pillars` | `list[PillarRef]` | `min_length=1` |
| `tone` | `str` | `min_length=1` |
| `formats` | `list[ContentFormat]` | `min_length=1` |
| `content_count` | `int` | `3 <= content_count <= 5` |
| `fact_sources` | `list[str]` | `min_length=1` |
| `owner_inputs` | `list[str]` | allowed empty |
| `funnel_stages` | `list[str]` | Advisory funnel stages across the week pack (e.g. `awareness`, `consideration`, `conversion`). Empty by default; the `funnel_mix` check is advisory-only and never blocks. |

### CycleState

| Field | Type | Notes |
| --- | --- | --- |
| `content_cycle_id` | `str` | UUID string of the Content cycle. |
| `week_number` | `int` | `1 <= week_number <= 13` in the eval schema so the Week-13 hard-rejection scenario can be represented. The contract validator still rejects 13 with `CONTENT_WEEK_OUT_OF_RANGE`. |
| `prior_content_pack_id` | `str | None` | Reference to the previous week's pack for immutability checks. |
| `next_week_context` | `NextWeekContext | None` | Owner-confirmed next-week context. |
| `next_week_context_absent` | `bool` | When `True`, `next_week_context` must be `None` and the generation must use safe no-promotion defaults. |

### NextWeekContext

| Field | Type | Notes |
| --- | --- | --- |
| `promotion_mode` | `Literal["none","owner_approved"]` | Safe default is `none`. |
| `promotion_text` | `str | None` | Only when `owner_approved`. |
| `promotion_terms` | `list[str]` | Offer terms. |
| `valid_from` | `str | None` | ISO datetime. |
| `valid_until` | `str | None` | ISO datetime. |
| `must_include` | `list[str]` | Owner requirements. |
| `must_avoid` | `list[str]` | Prohibited topics/phrases. |
| `approved_asset_ids` | `list[str]` | UUIDs of reusable assets. |
| `cta_destination_type` | `Literal["phone","whatsapp","website","address","none"]` | CTA type. |
| `cta_destination_value` | `str | None` | CTA value. |

### ProtectedFictionalFields

| Field | Type | Notes |
| --- | --- | --- |
| `business_name` | `str` | Fictional business name. |
| `owner_name` | `str` | Fictional owner name. |
| `handles` | `list[str]` | Social handles. |
| `addresses` | `list[str]` | Fictional addresses. |
| `prices` | `list[str]` | Fictional prices (never real). |
| `offer_terms` | `list[str]` | Fictional offer terms. |
| `owner_text` | `str` | Owner-provided text to be preserved. |

### ExpectedHardOutcome

| Field | Type | Notes |
| --- | --- | --- |
| `expected_result` | `Literal["pass","fail"]` | Overall deterministic expectation. |
| `per_guardrail` | `dict[str, Literal["pass","fail"]]` | Per-validator expectations. |
| `expected_error_codes` | `list[ContentErrorCode]` | Must be non-empty when `expected_result == "fail"`; must be empty when `expected_result == "pass"`. |

Phase 5 guardrail names added by the fake-provider validator:

- `provider_timeout` — passes when a provider-mode `timeout` case correctly surfaces a retryable `CONTENT_PROVIDER_FAILURE`.
- `asset_generation` — passes when provider-failed assets are labeled `status=failed` with `failure_code=CONTENT_PROVIDER_FAILURE` and never mislabeled as ready/generated live assets.
- `revision_preserves_caption`, `revision_preserves_creative_brief`, `revision_preserves_alt_text`, `revision_preserves_asset_ids`, `revision_preserves_strategy_trace` — pass when a revision call creates a new version while preserving the locked prior fields.

### FailureCategory

```
no_failure, unapproved_strategy, stale_profile, cycle_paused, cycle_completed,
week_out_of_range, week_already_claimed, channel_mismatch, unsupported_claim,
offer_unapproved, policy_violation, asset_required, schema_failure,
version_conflict, approval_blocked, provider_failure, candidate_tampered,
candidate_revoked, prompt_injection, revision_preservation
```

`revision_preservation` is the only failure category allowed on a passing case:
it marks a positive invariant test (prior state must survive revision) rather
than a hard-guardrail failure.

### HumanRubric

All six dimensions are `RubricScore`:

- `language`
- `tone`
- `usefulness`
- `pillar_alignment`
- `cta`
- `dialect` (Arabic-first market: dialect suitability is scored separately)

`RubricScore`:

| Field | Type | Notes |
| --- | --- | --- |
| `score` | `int` | `0 <= score <= 5` |
| `reviewer_handle` | `str` | Named reviewer, never a model. |
| `reviewed_at` | `str` | ISO timestamp. |
| `notes` | `str` | Optional human notes. |

### ReviewerSignOffs

| Field | Type | Notes |
| --- | --- | --- |
| `owner_mokhtar` | `ReviewerSignOff` | `@MOKHXXXXXX` — can explain why the case exists. |
| `eval_mostafa` | `ReviewerSignOff` | `@MostafaAhmed22` — methodology + safety/approval/publishing boundaries. |
| `ai_product_merzk` | `ReviewerSignOff` | `@mostafamerzk` — language/tone/usefulness/Strategy rubric. |
| `safety_rabee` | `ReviewerSignOff` | `@ARabee3` — contract + evaluator behavior tied to #107. |

A case is `final` only when all four `signed_off` flags are `True`.

## Derived properties

- `ContentEvalCase.is_final` — `True` when all four reviewers signed off.
- `ContentEvalCase.average_rubric_score` — average of the six rubric scores.

## Language mapping

The eval schema uses `ar`/`en`/`mixed`. The contract uses `ar-EG`/`en`/`mixed`.
Use ``to_contract_language_mode(mode)`` to translate before building contract
payloads.

## Validation invariants

1. `fixture_ref` or `policy_fixture` must be set (one is enough).
2. Failure cases must list at least one expected `ContentErrorCode`.
3. Passing cases must not list expected error codes and must use
   `failure_category="no_failure"`.
4. `next_week_context_absent` and `next_week_context` are mutually exclusive.
5. `week_number` is constrained to 1–13 at the eval schema level so Week-13 rejection cases can be represented; the contract validator still rejects 13 with `CONTENT_WEEK_OUT_OF_RANGE`.
6. All top-level models are frozen; any post-construction mutation raises.

## Why a separate schema version?

`content-eval-v1` is separate from the contract `content-v1` so that the
evaluation harness can evolve (add a new rubric dimension, split a reviewer
slot, add more per-guardrail detail) without breaking the frozen contract
fixtures or forcing old cases to be rewritten.

The eval schema is intentionally narrower than the contract: it does not carry
prompts, provider internals, or mutable database references, and it keeps the
human rubric and reviewer sign-off as first-class fields.