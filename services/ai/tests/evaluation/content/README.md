# Content Evaluation Harness (#109)

Deterministic evaluation of the Sprint 5A Content Agent against the frozen
`content-v1` contract. This folder is **contract-driven**: it never reimplements
safety rules that the frozen #107 contract already owns.

## What this harness is

- A dataset of immutable evaluation cases (≥15 baseline + adversarial mutation)
  authored in `cases/` and pinned to a `schema_version`.
- A set of deterministic validators in `validators/` that key off the frozen
  guardrails in `content-v1` and the existing `validate_content_policy_fixture`
  contract function.
- A fake Content provider in `providers/` that satisfies the #108
  `ContentLLMProvider` interface with mode flags (`normal`, `timeout`,
  `failed_image`, and revision-preservation in `normal` mode).
- A per-case pass/fail report engine in `reports/` — never aggregate-only.
- A deterministic runner in `runner/` plus a **Phase 6** real-provider
  comparison runner that is flag-driven and manual-only.
- A **Phase 7** reviewer sign-off tracker in `review_status.py` that surfaces
  which cases still need which reviewer slot.
- A **Phase 8** threshold engine in `runner/threshold.py` that applies
  expected-outcome matching and evaluates the documented bars
  (`docs/thresholds.md`): hard guardrails 1.0, rubric 0.9.
- Human sign-off slots per case in `cases/` — tracked per case, not only at
  issue close.

## What this harness is not

- It does **not** call paid providers in CI. The deterministic path runs with
  `FakeContentProvider` modes and zero network. Real-provider comparison is
  opt-in via `MARKETMIND_CONTENT_REAL_PROVIDER=1` and is never silent when the
  flag is unset (Phase 6).
- It does **not** treat one model-judge as proof of subjective quality. The
  rubric is human-scored by named reviewers.
- It does **not** publish, schedule, or evaluate live engagement. It evaluates
  contract behaviour and guardrail enforcement only.
- It does **not** use real business or competitor data — every case uses
  synthetic fictional business fields.
- Eval output is **not** approved business evidence.

## Frozen dependencies

| Source | Where | Status |
| --- | --- | --- |
| `content-v1` contract | `packages/contracts/CONTENT_CONTRACT.md` | Frozen by #107 (CLOSED) |
| Content fixtures | `packages/contracts/examples/content-*.json` | Frozen by #107 |
| Policy validator | `packages/contracts/python/content_contracts.py::validate_content_policy_fixture` | Frozen by #107 |
| Provider interface | `services/ai/app/providers/content_provider.py::ContentLLMProvider` | Frozen by #108 (CLOSED) |
| Generation/revision service | `services/ai/app/content/service.py` | Frozen by #108 |

## Reviewers (per-case sign-off slots)

| Role | GitHub handle | Scope |
| --- | --- | --- |
| Owner | `@MOKHXXXXXX` | Can explain why every case exists |
| Eval reviewer | `@MostafaAhmed22` | Evaluation methodology + safety/approval/publishing boundaries |
| AI/product reviewer | `@mostafamerzk` | Language/tone/usefulness/Strategy-alignment/dialect rubric |
| Safety reviewer | `@ARabee3` | Contract + evaluator behavior (ties to #107) |

A case is `final` only when all four reviewers have signed off. Sign-off status
is stored on the case (Phase 1 schema), not aggregated at issue close.

## Running the deterministic suite

```bash
cd services/ai
uv run pytest -m "not network and not integration" tests/content tests/evaluation/content
```

Or from the repo root (wired into CI):

```bash
npm run check:ai:content            # deterministic content suite
npm run check:ai:content:threshold  # assert the documented threshold bars
```

GitHub Actions CI (`deploy` not required) runs the content suite and asserts
the threshold verdict in the `content-eval` job of `.github/workflows/ai-ci.yml`.

## Running the Phase 6 real-provider spot-check

The real-provider comparison is **manual and opt-in**:

```bash
cd services/ai
export MARKETMIND_CONTENT_REAL_PROVIDER=1
export ai_provider_mode=openai        # or gemini_dev / openrouter
export openai_api_key=...
export openai_model=gpt-4.1-mini
uv run python -m tests.evaluation.content.runner.real_provider_runner
```

The spot-check uses a `text_post` request so the fake provider baseline is
expected to be contract-valid. The real provider receives a refined prompt
(`runner/real_provider_prompts.py`) that adds explicit spot-check constraints
and a one-shot structural example, so its structured output is far more likely
to satisfy the same deterministic contract validator.

The runner compares whether the real provider matches that baseline (both valid)
or diverges (real invalid while fake valid).

When the flag is unset the runner prints `[SKIPPED]` and exits cleanly. It never
runs in CI and never silently falls back to a fake provider.

## Running the Phase 7 reviewer sign-off report

```bash
cd services/ai
uv run python -m tests.evaluation.content.review_status
```

Prints a per-role pending count and the list of cases still awaiting sign-off.
A case is `final` only when all four reviewers (`owner_mokhtar`, `eval_mostafa`,
`ai_product_merzk`, `safety_rabee`) have signed off. The report is also
available programmatically via `build_review_status_report()`.

## Running the Phase 8 threshold verdict

```bash
cd services/ai
uv run python -m tests.evaluation.content.runner.threshold
```

Applies expected-outcome matching to every case and reports whether the
documented bars (`docs/thresholds.md`) are met: hard guardrails `1.0`, rubric
`0.9`. The verdict never hides unmet cases. It is also exposed programmatically
via `evaluate_thresholds()` / `run_all_verdict()`, and `run_all()` embeds the
threshold metrics into the run report.

See `docs/alignment.md` for the full Phase 0 alignment record, and
`docs/out-of-scope.md` for what this harness deliberately does not cover.