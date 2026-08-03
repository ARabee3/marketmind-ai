# Phase 8 — Threshold Bars

Schema version: `content-eval-v1`  
Engine: `runner/threshold.py`

This document records the acceptance bars the Content eval harness must meet and
how the threshold engine evaluates them. Bars are explicit so the issue cannot
close on an aggregate-only green result or on an unstated pass/fail rule.

## Bars

| Bar | Value | Meaning |
| --- | --- | --- |
| Hard guardrails required | **1.0** | Every eval case's expected outcome must match the actual deterministic validator outcome. |
| Rubric review required | **0.9** | At least 90% of *applicable* human rubric dimensions must be reviewed (scored, named reviewer, timestamp). |

The overall verdict passes only when both bars are met.

## Expected-outcome matching

The deterministic runner reports raw validator pass/fail per case. The threshold
engine instead compares each case against its own `expected_hard_outcome`:

- **Per-guardrail matching** — each entry in `expected_hard_outcome.per_guardrail`
  maps (via `GUARDRAIL_CHECK_MAP`) to the concrete validator check name(s):
  - expected `pass` → the mapped check is absent **or** passed;
  - expected `fail` → at least one mapped check actually fired.
- **Fallback** — cases with no per-guardrail detail match on the top-level
  `expected_result` vs. the raw validator pass/fail.
- A case that errors during evaluation is always unmet and listed with the error.

This lets adversarial cases that are *expected to fail* count as met when the
right guardrail fires, e.g. `mutation-unapproved-strategy` fires
`contract:CONTENT_STRATEGY_NOT_APPROVED`.

### Provider cases

- `mutation-provider-timeout` expects `provider_timeout` to **pass** (the fake
  provider correctly surfaced a retryable `CONTENT_PROVIDER_FAILURE`), even
  though the top-level business outcome is a failure. Matching is per-guardrail,
  so this case is met.
- `mutation-failed-image-generation` expects `asset_generation` to pass: assets
  are never labeled ready when provider-failed, and a `CONTENT_PROVIDER_FAILURE`
  blocker is present.

## Rubric applicability

A rubric dimension only applies where content was actually produced for a human
to score. Cases rejected by a hard guardrail before any content exists carry an
N/A rubric (`score 0` with `Rubric N/A` notes) and are excluded from the rubric
denominator. An applicable dimension is covered when scored by a named reviewer
with a timestamp.

## Behavior guarantees

- Unmet cases are never hidden: `ThresholdVerdict.unmet_case_ids` and the human
  summary always list every non-matching case with its reasons, even when the
  aggregate bars pass.
- The threshold engine is deterministic: no LLM, no network, no paid provider.

## Running

```bash
cd services/ai
uv run python -m tests.evaluation.content.runner.threshold
```

## Acceptance

- [x] `runner/threshold.py` applies expected-outcome matching per case.
- [x] `GUARDRAIL_CHECK_MAP` covers every `per_guardrail` key used in the datasets.
- [x] Hard-guardrail bar is 1.0 and met by the current 33-case run.
- [x] Rubric bar is 0.9 and met by the current 33-case run.
- [x] Provider-timeout and revision-preservation count as met via per-guardrail matching.
- [x] Aggregate bars never hide individual unmet cases.
- [x] `runner/test_threshold.py` covers matching and bar evaluation.
- [x] `run_all()` / `run_all_verdict()` expose the verdict; report embeds threshold metrics.
