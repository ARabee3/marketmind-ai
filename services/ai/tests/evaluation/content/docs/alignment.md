# Phase 0 — Alignment Record

Recorded before authoring any cases or validators. The entries below confirm
the frozen surface this harness keys off.

## 1. #107 frozen contract surface

**Issue #107 status:** CLOSED on `main` (assignee `@mostafamerzk`,
`[Content Contracts] Freeze content-v1 lifecycle, safety policy, and publishing
handoff`).

### Contract document

`packages/contracts/CONTENT_CONTRACT.md` — frozen. Key points the harness keys
off:

- `ContentCycle.status ∈ {active, paused, completed}`.
- Week numbers are integers 1–12 inclusive. Week 13 requires a new approved
  Strategy.
- Each `(content_cycle_id, week_number)` has one atomic weekly claim;
  duplicates fail with `CONTENT_WEEK_ALREADY_CLAIMED`.
- Missing owner context before cutoff produces a safe default context with
  `context_source = "system_defaulted"`, `promotion_mode = "none"`,
  `promotion = null`, and `confirmed_by_user_id = null` — never invents timely
  facts or carries an expired offer.
- `ContentItemVersion` is immutable; changed item requires a new version and
  approval.
- Asset kinds: `owner_supplied`, `generated_static`, `prompt_only`. Asset
  statuses: `generating`, `ready`, `missing`, `failed`, `blocked`.
- `prompt_only` assets never satisfy image-bearing content and never appear in
  `PublicationCandidateV1`.
- Stable error codes (exported from `content_contracts.ContentErrorCode`):
  `CONTENT_STRATEGY_NOT_APPROVED`, `CONTENT_PROFILE_STALE`,
  `CONTENT_CYCLE_PAUSED`, `CONTENT_CYCLE_COMPLETED`,
  `CONTENT_WEEK_OUT_OF_RANGE`, `CONTENT_WEEK_ALREADY_CLAIMED`,
  `CONTENT_CHANNEL_MISMATCH`, `CONTENT_UNSUPPORTED_CLAIM`,
  `CONTENT_OFFER_UNAPPROVED`, `CONTENT_POLICY_VIOLATION`,
  `CONTENT_ASSET_REQUIRED`, `CONTENT_SCHEMA_FAILURE`,
  `CONTENT_VERSION_CONFLICT`, `CONTENT_APPROVAL_BLOCKED`,
  `CONTENT_PROVIDER_FAILURE`, `CONTENT_CANDIDATE_TAMPERED`,
  `CONTENT_CANDIDATE_REVOKED`.

### Frozen fixtures

`packages/contracts/examples/content-*.json` (30+ frozen valid/invalid
fixtures). Mutation cases (Phase 3) reuse these as the truth set rather than
re-authoring adversarial cases from scratch. Selected mapping:

| Guardrail target | Frozen fixture |
| --- | --- |
| Unapproved Strategy | `content-strategy-unapproved.invalid.json` |
| Stale Business Profile | `content-profile-stale.invalid.json` |
| Wrong channel | `content-wrong-channel.invalid.json` |
| Channel/trace mismatch | `content-trace-channel-mismatch.invalid.json` |
| Week mismatch | `content-trace-week-mismatch.invalid.json` |
| Duplicate weekly claim | `content-duplicate-week-claim.invalid.json` |
| Cycle paused | `content-cycle-paused.invalid.json` |
| Cycle completed | `content-cycle-completed.invalid.json` |
| Week 13 | `content-week-13.invalid.json` |
| Pack too few items | `content-pack-too-few-items.invalid.json` |
| Pack too many items | `content-pack-too-many-items.invalid.json` |
| Pack strategy version mismatch | `content-pack-strategy-version-mismatch.invalid.json` |
| Item/pack mismatch | `content-item-pack-mismatch.invalid.json` |
| Invented promotion | `content-invented-promotion.invalid.json` |
| Expired promotion | `content-expired-promotion.invalid.json` |
| Unconfirmed price | `content-unconfirmed-price.invalid.json` |
| Unconfirmed availability | `content-unconfirmed-availability.invalid.json` |
| Unsupported testimonial | `content-unsupported-testimonial.invalid.json` |
| Guarantee claim | `content-guarantee-claim.invalid.json` |
| Regulated claim | `content-regulated-claim.invalid.json` |
| Competitor superiority | `content-competitor-superiority.invalid.json` |
| Superiority claim | `content-superiority-claim.invalid.json` |
| Branded undisclosed | `content-branded-undisclosed.invalid.json` |
| Protected text mutated | `content-protected-text-mutated.invalid.json` |
| Missing required asset | `content-missing-required-asset.invalid.json` |
| Empty alt text | `content-empty-alt-text.invalid.json` |
| Alt text too long | `content-alt-text-too-long.invalid.json` |
| Asset owner mismatch | `content-asset-owner-mismatch.invalid.json` |
| Provider failure | `content-provider-failure.invalid.json` |
| Schema failure | `content-schema-failure.invalid.json` |
| Version conflict | `content-version-conflict.invalid.json` |
| Decision item mismatch | `content-decision-item-mismatch.invalid.json` |
| Approval blocked | `content-approval-blocked.invalid.json` |
| Default-context owner claim | `content-default-context-owner-claim.invalid.json` |
| Valid Week-1 (ar/en/mixed) | `content-pack-week-1-*.example.json` |
| Valid Week-2 rollover | `content-pack-week-2-rollover.example.json` |
| Valid owner-confirmed context | `content-week-context-owner-promotion.example.json` |
| Valid safe-default context | `content-week-context-safe-default.example.json` |
| Valid owner-asset version | `content-item-version-owner-asset.example.json` |
| Valid generated-asset version | `content-item-version-generated-asset.example.json` |
| Valid prompt-only version | `content-item-version-prompt-only.example.json` |

### Frozen policy validator

`packages/contracts/python/content_contracts.py::validate_content_policy_fixture`
implements every documented guardrail as a deterministic function over a
`ContentPolicyFixture` dict. The harness reuses this function for Phase 4
validators. **It does not reimplement safety rules.**

### Gaps requiring follow-up (tracked, not blocking)

- **Pillar mismatch**: there is no frozen `content-pillar-mismatch.invalid.json`
  fixture. The frozen `content-trace-channel-mismatch.invalid.json` covers
  trace channel mismatch but not pillar mismatch. Phase 3 will treat this as a
  known limitation rather than author a sibling fixture (authoring fixtures
  belongs to #107, not #109). A follow-up note will be added to `out-of-scope.md`.

- **Prompt injection**: there is no frozen fixture with an embedded injection
  inside `week_context.must_include` / `must_avoid` / `cta_destination`. Phase
  3 will author the injection text inline in the case file's
  `protected_fictional_fields.owner_text` (eval-only synthetic injection text,
  clearly labeled, never real business data).

## 2. #108 frozen provider interface

**Issue #108 status:** CLOSED on `main` (merge commit `5dc459d`).

### `ContentLLMProvider` abstract base

`services/ai/app/providers/content_provider.py`:

```python
class ContentLLMProvider(ABC):
    name: str

    @abstractmethod
    async def generate_content_pack(
        self, prompt: PromptAssembly
    ) -> list[ContentItemVersion]: ...

    @abstractmethod
    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion: ...
```

The fake provider in `providers/` (Phase 5) subclasses this base and matches
the same two async methods, so it can be swapped in for real providers without
changing call sites.  Implemented modes:

- `normal` — deterministic grounded content pack; supports revision that
  preserves prior `caption_variants`, `creative_brief`, `alt_text`, `asset_ids`,
  and Strategy-locked `strategy_trace` fields.
- `timeout` — raises a retryable `CONTENT_PROVIDER_FAILURE` so the harness can
  verify timeout surfacing.
- `failed_image` — text generation succeeds but the required static image is
  provider-failed (`status=failed`, `failure_code=CONTENT_PROVIDER_FAILURE`).

### Asset-state hard check (Phase 5)

Every generated asset must be one of:

- `owner_supplied` — status `ready`, provided by the owner.
- `generated_static` — status `ready` with a real `checksum` and `storage_key`.
- `prompt_only` — never labeled as `ready`/`generated_static` live asset.
- `missing` — status `missing`, clearly not publishable.
- `provider_failed` — status `failed` with `failure_code=CONTENT_PROVIDER_FAILURE`.

Zero tolerance for a prompt-only or simulated asset being labeled as a
ready/generated live asset.

### Existing reference fakes

- `MockContentProvider` in `content_provider.py` — deterministic grounded
  output, used as the normal-mode base for Phase 5.
- `TimeoutThenValidProvider` in `tests/content/test_provider_fake_matrix.py`
  — pattern for `timeout` mode (first call raises `CONTENT_PROVIDER_FAILURE`
  with `retryable=True`, second call returns valid items).

### Service entry points

`services/ai/app/content/service.py` exports:

- `generate_content_pack_with_repair(...)` — bounded repair + retry around
  `generate_content_pack`.
- `revise_content_item_with_repair(...)` — bounded repair + retry around
  `revise_content_item`.

The harness uses these to drive end-to-end cases (Phase 5 + Phase 11) and to
prove revision-preservation (a revision call must preserve prior
`caption_variants`, `creative_brief`, `alt_text`, `asset_ids`, and Strategy-
locked `strategy_trace` fields across a new week's draft — Phase 3 mutation
target).

## 3. Scaffolded folder layout

```
services/ai/tests/evaluation/content/
├── cases/         # baseline + adversarial case files (Phase 2/3)
├── validators/    # deterministic validators keying off #107 (Phase 4)
├── providers/     # fake ContentLLMProvider modes (Phase 5)
├── reports/       # per-case pass/fail report engine (Phase 4)
├── runner/        # threshold + dataset runner + self-tests (Phase 4/8)
└── docs/          # alignment, schema ref, coverage, mutation map, thresholds, out-of-scope (Phase 2/3/8/9)
```

Each subfolder has an `__init__.py` so pytest can import from it cleanly.

## 4. Reviewer assignments (per-case sign-off slots)

Confirmed up front. Each `ContentEvalCase` will carry four named reviewer
slots (Phase 1 schema). A case is `final` only when all four are signed.

| Slot key | Role | GitHub handle | Scope |
| --- | --- | --- | --- |
| `owner_mokhtar` | Owner | `@MOKHXXXXXX` | Can explain why every case exists |
| `eval_mostafa` | Eval reviewer | `@MostafaAhmed22` | Evaluation methodology + safety/approval/publishing boundaries |
| `ai_product_merzk` | AI/product reviewer | `@mostafamerzk` | Language/tone/usefulness/Strategy-alignment/dialect rubric |
| `safety_rabee` | Safety reviewer | `@ARabee3` | Contract + evaluator behavior (ties to #107) |

`review_status.py` (Phase 7) will surface which cases still need which reviewer.
The issue cannot close until every slot on every case is signed, in addition to
the threshold bars in `docs/thresholds.md` (Phase 8).

Phase 8 is implemented in `runner/threshold.py` (`evaluate_thresholds`,
`match_expected_outcome`) with `docs/thresholds.md`. The engine applies
expected-outcome matching per case (hard-guardrail bar 1.0, rubric bar 0.9) and
never hides unmet cases behind aggregate bars.

## 5. CI contract (Phase 5/10 preview)

- The deterministic path (default) uses `MockContentProvider` / the Phase 5
  fake modes and requires no paid provider and no external network.
- The real-provider path (Phase 6) requires
  `MARKETMIND_CONTENT_REAL_PROVIDER=1` and a separate credential env. When
  unset, the run is **visibly skipped**, never silent.
- Phase 6 is implemented in `runner/real_provider_runner.py`. It creates a real
  `ContentLLMProvider` via `create_content_provider`, spot-checks the same
  representative request used by the fake provider, and compares contract
  validation results (`fake_valid` vs `real_valid`).
- Phase 10 wires the deterministic path into CI: the `content-eval` job in
  `.github/workflows/ai-ci.yml` runs `tests/evaluation/content` (no network, no
  paid provider) and then asserts the documented threshold bars via
  `python -m tests.evaluation.content.runner.threshold`, which exits non-zero
  when bars are unmet. The real-provider path stays opt-in and never runs in CI.

### Phase 10 acceptance (CI wiring)

- [x] `check:ai:content` runs the deterministic content suite from the repo root.
- [x] `check:ai:content:threshold` runs the threshold verdict from the repo root.
- [x] `.github/workflows/ai-ci.yml` has a `content-eval` job running the suite.
- [x] CI asserts the threshold verdict and fails the build when bars are unmet.
- [x] No paid provider and no network are used by the CI content job.

## 6. Phase 6 acceptance (real-provider comparison)

- [x] `runner/real_provider_runner.py` implements the opt-in real-provider path.
- [x] `MARKETMIND_CONTENT_REAL_PROVIDER=1` is the single gate; unset runs are
      visibly skipped.
- [x] Misconfigured env (flag set but `ai_provider_mode=mock`) raises a clear
      error instead of silently falling back to fake.
- [x] Spot-check compares fake and real provider validation results for the same
      representative request.
- [x] Real provider uses a refined prompt (`runner/real_provider_prompts.py`)
      with explicit contract-validator constraints and a one-shot example.
- [x] No paid provider is called in CI; the manual test is skipped when the flag
      is absent.
- [x] README documents the run command, required env vars, and prompt refinements.

## 7. Phase 0 acceptance (for issue #109)

Phase 0 is complete when:

- [x] Folder layout scaffolded under `tests/evaluation/content/` with the
      documented subfolders.
- [x] #107 frozen surface enumerated and the frozen fixtures inventoried.
- [x] #108 provider interface shape documented; fake stub will match.
- [x] Reviewer assignments locked with per-case sign-off scope.
- [x] README + alignment record committed.
- [x] `test_phase0_imports.py` asserting the frozen paths import.

## 8. Phase 9 acceptance (documentation pack)

Phase 9 is complete when the doc set under `docs/` covers the harness end to end:

- [x] `alignment.md` — Phase 0 frozen-surface alignment and phase acceptance.
- [x] `coverage-matrix.md` — baseline coverage matrix (Phase 2).
- [x] `mutation-to-guardrail.md` — adversarial mutation map (Phase 3).
- [x] `schema-ref.md` — `content-eval-v1` case schema reference.
- [x] `thresholds.md` — documented threshold bars (Phase 8).
- [x] `out-of-scope.md` — tracked gaps and permanent non-goals.
- [x] README links the harness doc set.

## 9. Phase 11 acceptance (final verification & sign-off)

Phase 11 is complete when the following verification steps have been run and
accepted:

- [x] Evaluator self-tests pass (`tests/evaluation/content/test_validators.py`).
- [x] Full deterministic dataset run passes: 15 baseline + 19 mutation cases (34 total).
- [x] Guardrail mutation tests pass (`tests/evaluation/content/cases/test_mutation_cases.py`).
- [x] Arabic / English / mixed protected-fictional-field checks pass
      (`test_baseline_cases.py` + schema language tests).
- [x] Report snapshot + threshold-failure tests pass (`test_validators.py`
      report checks + `runner/test_threshold.py`).
- [x] One reviewed real-provider comparison run executed
      (`runner/real_provider_runner.py`). Result: fake valid, real invalid,
      `Match: False` — tracked as enhancement issue #136.
- [x] Acceptance criteria line-by-line:
  - [x] ≥15 cases: 34 cases (15 baseline + 19 mutation).
  - [x] 5 sectors covered (hospitality, retail, services, education, healthcare).
  - [x] ar / en / mixed language modes covered across all sectors.
  - [x] Both success and every failure category tested. All 18 content-side
        `FailureCategory` values are exercised directly in the dataset or via
        validator self-tests; only `candidate_tampered` and `candidate_revoked`
        (publishing-v1 #118) are out of scope and documented.
  - [x] Marketing-quality additions (issue #109): dialect rubric dimension added,
        funnel-mix advisory check added (never blocks), and health/clinical-claim
        mutation case added via the frozen regulated path.
  - [x] 100% hard guardrails met (threshold verdict `1.0`).
  - [x] Rubric threshold is configured at 0.9 and is gated by reviewer sign-off
        (`reviewers.ai_product_merzk.signed_off`).  It will report 1.0 once the
        AI/product reviewer signs off the applicable cases; until then the issue
        stays open with the failed rubric bar listed, as required by #109.
  - [x] Actionable per-case failure reasons preserved in the report.
  - [x] No paid provider in CI: deterministic job runs
        `-m "not network and not integration"`.
  - [x] Reproducible, separated real-provider runs: opt-in via
        `MARKETMIND_CONTENT_REAL_PROVIDER=1`.
  - [x] No real or synthetic-as-real data: all business fields are fictional and
        labeled.
  - [x] Revision immutability proven: mutation-revision-preservation passes all
        five per-field guardrails.
  - [x] All 5 asset states correctly distinguished by provider checks
        (`tests/evaluation/content/providers/test_providers.py`).