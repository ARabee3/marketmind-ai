## PR #101 Review: `feature/75-build-rag-retrieval-and-strategy-grounding-suite`

### Overall Assessment

This PR delivers substantial infrastructure for the retrieval evaluation suite. The dataset (25 cases × 5 sectors × 3 languages), deterministic runners (retrieval, filter, generation, grounding), report system, fixtures, and self-tests form a solid foundation. However, I found **2 critical, 3 medium, and 2 minor issues** that should be addressed before merge.

---

### 🔴 CRITICAL

**C1. Fake embedding provider semantic change without notice** (`services/ai/app/embeddings/fake_provider.py:15-36`)

The `DeterministicFakeEmbeddingProvider._generate_vector` was rewritten from SHA-256 hash (whole-text → random vector) to word-level hashing with weighted average (keyword-based similarity).

**Before:** `seed = int(hashlib.sha256(text.encode()).hexdigest()[:16], 16)` → RNG → normal distribution → normalize → each text gets a unique deterministic vector regardless of similarity.

**After:** `re.findall(r"\w+", text.lower())` → per-word seeded unit vectors → `weight = 2.0 if len(w) > 3 else 1.0` weighted average → normalize → texts sharing keywords get similar vectors.

The new behavior is **better** for testing (it mimics real embedding cosine similarity), but:
- The change is undocumented in commits and PR description
- Existing tests relying on the old provider's behavior may see different ranking results
- The `@note` or commit message should explain *why* the change was made

**Fix:** Add a docstring note explaining the keyword-similarity semantics. Verify no existing tests (outside this PR) depend on the old behavior.

**C2. `eval_smoke` and `eval_full` pytest markers registered in pyproject.toml — actually now I don't see a CRITICAL C2, let me re-check.**

Actually the markers **are** missing from `pyproject.toml` — only `integration` and `network` are registered. Running `pytest -m eval_smoke` will produce `PytestUnknownMarkWarning`. This is noisy in CI.

**Fix:** Add `eval_smoke` and `eval_full` to the `markers` list in `services/ai/pyproject.toml`.

---

### 🟡 MEDIUM

**M1. No CI pipeline integration** (no `.github/workflows/` changes in PR)

The dataset README documents the smoke command (`pytest -m eval_smoke`), but there is no CI workflow change to run these tests. Issue #75 explicitly requires "CI smoke subset + documented full-suite command". The full-suite command is documented (README). The smoke subset needs CI wiring.

**Fix:** Add a CI step (e.g., in existing workflow) that runs `PYTHONPATH=. pytest tests/evaluation -m eval_smoke -v` for push/PR against relevant paths.

**M2. `requires_paid_media` filter path untested** (`services/ai/app/rag/filter_builder.py:43-44`)

The filter_builder adds:
```python
FieldCondition(key="requires_paid_media", match=MatchValue(value=True))
```
when `paid_media_allowed=False`. No fixture item has `requires_paid_media`, so this code path is never exercised in tests. The `paid_media_allowed` filtering relies entirely on the `budget_modes` MatchAny condition hitting item `a0000000-0005` only.

**Fix:** Add one fixture item with `requires_paid_media: true` and add a test case that expects it to be filtered when `paid_media_allowed=False`.

**M3. `RetrievalQueryContext.paid_media_allowed` field is dead code** (`app/rag/schemas.py` vs `query_builder.py`)

The `retrieval_runner.py` passes `paid_media_allowed=case.query_input.paid_media_allowed` to `RetrievalQueryContext(...)`, but `query_builder.py` recomputes `paid_media_allowed` from `context.budget_mode` and ignores the field:
```python
paid_media_allowed = False if context.budget_mode == "organic_only" else True
```

This means a case with `budget_mode: "monthly_amount"` and `paid_media_allowed: false` would still get `paid_media_allowed: true` from the query_builder. The dataset schema field is misleading.

**Fix:** Either (a) remove `paid_media_allowed` from `RetrievalQueryInput`/`RetrievalQueryContext` since budget_mode drives it, or (b) have query_builder read `context.paid_media_allowed` and only fall back to budget_mode when it's None.

---

### 🟢 MINOR

**m1. RAG comparison smoke test synthesizes a perfect pack** (`test_rag_comparison.py:_build_case_pack`)

The comparison test builds a `RetrievedKnowledgePack` from `expected_chunk_ids` with stub content. The pack is always perfect — it only contains expected items. This tests the generation+grounding pipeline, not real retrieval quality. The comment `"In the mock test pipeline there is no live Qdrant"` explains the approach, but the `@pytest.mark.eval_full` test `test_rag_vs_norag_comparison_all_cases` could give a false sense of RAG coverage.

**Not blocking** — this is acceptable for CI. Consider adding a smoke-level test that actually uses the Qdrant in-memory + fixture pipeline (like the retrieval runner test does) to verify the full retrieval→generation pipeline once.

**m2. French locale items in knowledge_base fixture have the wrong semantics** (`fixtures/knowledge_base.json`)

Items `a0000000-00f1` and `a0000000-00f2` have `locale: "fr"` but `markets: ["france"]`. They are used to test incompatible-locale filtering (EG cases should not match French items). However, item `a0000000-00f3` has `locale: "fr"` but `markets: ["egypt"]` — a French-locale item claiming to be relevant in Egypt. The `test_incompatible_locale_filtered` test correctly filters it via locale, but the `markets: ["egypt"]` / `locale: "fr"` combination is contradictory in real data. Not a bug, just confusing.

---

### ✅ What the PR does well

- **Dataset coverage**: 25 cases × 5 sectors × 3 languages, with varied budget/channel/team conditions
- **Privacy boundary enforcement**: `test_privacy_evaluation.py` verifies no PII leaks in Qdrant payloads
- **Determinism**: `test_determinism.py` verifies identical runs produce identical results
- **Citation integrity**: `GroundingChecker` with 4 checks (integrity, resolution, benchmark, source enforcement)
- **Report system**: `EvaluationReport` with `format_human_summary` and `format_json_report`
- **Hard filter coverage**: expired, unapproved, future-effective, incompatible-locale, paid-media filters
- **Gap detection**: `test_missing_result_evaluation.py` verifies empty-result/knowledge-gap behavior
- **No paid API dependency**: Qdrant `:memory:` mode + DeterministicFakeEmbeddingProvider + mock LLM
- **Self-test suite**: `test_evaluator_self_test.py` with known-pass and known-fail cases
- **Marketingskills adaptation**: `test_marketingskills_adapt.py` with 4 checks against raw skill leakage and unlocalized SaaS jargon
- **Versioned dataset**: `eval-v1` with reviewer attribution and dates

### Summary

| Category | Critical | Medium | Minor |
|----------|----------|--------|-------|
| Found    | 2        | 3      | 2     |
| **Fix C1 (docstring + verify old tests) + M1 (CI wiring) + M2 (fixture coverage) + M3 (dead field) before merge.**


## PR #101 Review: `feature/75-build-rag-retrieval-and-strategy-grounding-suite`

### Overall Assessment

This PR delivers substantial infrastructure for the retrieval evaluation suite. The dataset (25 cases × 5 sectors × 3 languages), deterministic runners (retrieval, filter, generation, grounding), report system, fixtures, and self-tests form a solid foundation. However, I found **2 critical, 3 medium, and 2 minor issues** that should be addressed before merge.

---

### 🔴 CRITICAL

**C1. Fake embedding provider semantic change without notice** (`services/ai/app/embeddings/fake_provider.py`)

The `DeterministicFakeEmbeddingProvider._generate_vector` was rewritten from SHA-256 hash (whole-text → random vector) to word-level hashing with weighted average (keyword-based similarity).

**Before:** `seed = int(hashlib.sha256(text.encode()).hexdigest()[:16], 16)` → RNG → normal distribution → normalize. Each unique text gets a deterministic random vector. Two similar texts get completely different vectors.

**After:** `re.findall(r"\w+", text.lower())` → per-word seeded unit vectors → `weight = 2.0 if len(w) > 3 else 1.0` weighted average → normalize. Texts sharing keywords get similar vectors.

The new behavior is **better** for testing (it mimics real embedding cosine similarity), but:
- The change is undocumented in commits and PR description
- Existing tests relying on the old provider's behavior may see different ranking results

**Fix:** Add a docstring explaining the keyword-similarity semantics. Verify no existing tests (outside this PR) depend on the old behavior.

**C2. `eval_smoke` and `eval_full` pytest markers not registered** (`services/ai/pyproject.toml`)

Only `integration` and `network` markers are registered. Running `pytest -m eval_smoke` will produce `PytestUnknownMarkWarning` — noisy in CI.

**Fix:** Add both markers to `pyproject.toml`.

---

### 🟡 MEDIUM

**M1. No CI pipeline integration** (no `.github/workflows/` changes)

The dataset README documents the smoke command, but there is no CI workflow change to actually run these tests. Issue #75 requires "CI smoke subset + documented full-suite command."

**Fix:** Add a CI step running `PYTHONPATH=. pytest tests/evaluation -m eval_smoke -v` for push/PR against relevant paths.

**M2. `requires_paid_media` filter path untested** (`filter_builder.py`)

The filter adds `must_not` for `requires_paid_media=true` when `paid_media_allowed=False`. No fixture item has `requires_paid_media` — this code path is never exercised.

**Fix:** Add one fixture item with `requires_paid_media: true` and add a test case.

**M3. `RetrievalQueryContext.paid_media_allowed` field is dead code**

`retrieval_runner.py` passes `paid_media_allowed` to `RetrievalQueryContext`, but `query_builder.py` recomputes it from `budget_mode` and ignores the field. A case with inconsistent `budget_mode` and `paid_media_allowed` gets the budget_mode-derived value silently.

**Fix:** Either (a) remove the field since budget_mode drives it, or (b) make query_builder read `context.paid_media_allowed` with budget_mode fallback.

---

### 🟢 MINOR

**m1. RAG comparison test synthesizes perfect pack** (`test_rag_comparison.py`)

The RAG comparison builds packs from `expected_chunk_ids` with stub content. This tests the generation+grounding pipeline, not real retrieval quality. Acceptable for CI, but the `eval_full` test could give a false sense of RAG coverage.

**m2. `locale: "fr"` / `markets: ["egypt"]` combo in knowledge_base fixture**

Item `a0000000-00f3` has French locale but Egypt market — contradictory in real data. Not a bug, just confusing.

---

### ✅ What works well

- **Dataset**: 25 cases × 5 sectors × 3 languages, varied conditions, reviewer attribution, versioned
- **Privacy boundary**: `test_privacy_evaluation.py` verifies no PII leaks in Qdrant payloads
- **Determinism**: `test_determinism.py` verifies identical runs produce identical results
- **Citation integrity**: `GroundingChecker` with 4 checks (integrity, resolution, benchmark, source enforcement)
- **Hard filter coverage**: expired, unapproved, future-effective, incompatible-locale, paid-media
- **Gap detection**: `test_missing_result_evaluation.py` verifies empty-result / knowledge-gap behavior
- **No paid API**: Qdrant `:memory:` + DeterministicFakeEmbeddingProvider + mock LLM
- **Self-test suite**: known-pass and known-fail cases in `test_evaluator_self_test.py`
- **Marketingskills adaptation**: 4 checks against raw skill leakage and unlocalized SaaS jargon

### Summary

Fix **C1** (docstring + verify old tests), **C2** (register markers), **M1** (CI wiring), **M2** (requires_paid_media fixture), **M3** (dead field) before merge.


Requesting changes because this PR does not yet satisfy issue #75 or the Sprint 4 RAG evaluation acceptance criteria.

1. The evaluation suite is not green

`cd services/ai && uv run pytest tests/evaluation -q` currently fails with:

`2 failed, 43 passed, 1 xfailed, 1 error`

The failing area is part of the feature being introduced, so this cannot be treated as a non-blocking test problem.

Required fix:
- Make the full `tests/evaluation` suite pass locally.
- Register the custom pytest markers such as `eval_smoke` and `eval_full` so the suite does not emit unknown-marker warnings.
- If any test needs PostgreSQL, document the required setup or split it into an integration-marked command that is not presented as CI-ready unless the DB is available.

2. RAG vs no-RAG comparison is not using real retrieval output

`services/ai/tests/evaluation/test_rag_comparison.py` builds RAG packs from `expected_chunk_ids` and stub text instead of using the retrieval runner output. This bypasses the real retrieval path and makes the comparison optimistic by construction.

Required fix:
- Build the RAG comparison pack from the actual retrieval result for each case.
- Do not seed the generation comparison directly from `expected_chunk_ids`.
- The no-RAG run should use an empty pack, while the RAG run should use the same pack produced by the retrieval pipeline.
- The comparison report should state which chunks were retrieved, which expected chunks were missed, and whether the generated strategy cited retrieved evidence correctly.

3. Synthetic comparison packs do not match the `RetrievedKnowledgePack` contract

The current comparison helper creates items with missing required fields such as `entry_version`, `excerpt`, `tags`, and `relevance_score`, and passes `source_quality` as a string. This is why the comparison tests fail contract validation.

Required fix:
- Remove the hand-built stub item shape or replace it with proper contract builders that produce valid `RetrievedKnowledgePack` items.
- Prefer using the existing contract examples or retrieval adapter output rather than duplicating the schema manually.
- Add a contract-validation assertion before running generation so schema drift fails early with a clear message.

4. Missing-knowledge safety is hidden behind `xfail`

`test_no_false_positives_for_missing_knowledge` is marked as expected-fail. Issue #75 and Sprint 4 require empty/failed retrieval to remain visible and never produce unsupported claims. An xfailed acceptance test means this requirement is not proven.

Required fix:
- Remove the `xfail`.
- Fix the fake embedding/retrieval setup so missing-knowledge cases do not accidentally match unrelated fixture data.
- Add at least one adversarial missing-knowledge case where retrieval must return no usable result and the output must contain a visible knowledge gap.

5. Source-governance checking misses the actual source references

`grounding_checker.py` checks citation title and entry ID for raw `marketingskills` / GitHub leakage, but the real source references are carried in `source_quality.source_references` and are included in strategy prompts. A raw external source reference can therefore bypass the checker.

Required fix:
- Validate `source_quality.source_references` for every retrieved item and every generated citation path.
- Do not rely on a two-string denylist. Check that citations resolve only to approved MarketMind knowledge entries or approved source records.
- Add an adversarial test where a retrieved item contains a raw external repo/source reference and assert that grounding fails.

6. Numeric benchmark validation is incomplete

The grounding checker only verifies that a benchmark citation points to an item whose evidence tier contains `verified_benchmark`. Sprint 4 requires numeric benchmark ranges to cite a retrieved benchmark that is current, compatible, and cited.

Required fix:
- Validate that benchmark citations resolve to a retrieved item with `evidence_tier = verified_benchmark`.
- Also validate `review_status`, `effective_at`, `expires_at`, market, locale, industry/channel compatibility, and source resolution.
- Add negative tests for expired, future-effective, wrong-market, wrong-locale, and non-benchmark numeric citations.

7. Persistence-resolution test rewrites generated citations before checking them

`test_persistence_resolution.py` generates a plan, then replaces `plan.citations` with citations built from the retrieval pack before running the grounding/persistence assertions. That no longer tests whether the generated strategy cited persisted retrieval correctly.

Required fix:
- Do not mutate `plan.citations` before validation.
- Validate the actual citations returned by the generation step.
- If the mock provider cannot produce realistic citations, fix the mock provider or fixture input so it emits contract-valid citations naturally.

8. Paid-media filter references a field that is not stored in the Qdrant payload

`filter_builder.py` filters on `requires_paid_media`, but `QdrantKnowledgePoint` does not include that field. The `budget_modes` filter exists, but the explicit `requires_paid_media` condition is currently ineffective unless the payload is extended.

Required fix:
- Either add `requires_paid_media` to the Qdrant payload model and ingestion path, or remove that condition and express the rule fully through fields that are actually indexed/stored.
- Add a test that reads back the stored Qdrant payload and proves the paid-media rule is enforced against persisted payload data, not just local fixture JSON.

9. Marketingskills adaptation evaluation is too shallow

The current checks mostly assert that a default mock plan does not contain a few SaaS/B2B terms. Issue #75 requires an adapted-vs-unadapted comparison, Egyptian SME usefulness, localization diagnostics, prompt-pattern leakage checks, and generic-framework-noise detection.

Required fix:
- Add case-driven tests that compare adapted prompts/patterns against a no-adaptation baseline.
- Score traceability, completeness, owner usefulness, Egyptian SME wording, and generic-framework noise.
- Run this on Arabic, English, and mixed cases, not only `default_plan()`.
- Report localization gaps, prompt-pattern leakage, deterministic-rule violations, and corpus gaps separately.

10. Evaluation report is retrieval-only and does not include the required end-to-end evidence

`EvaluationReport` currently reports retrieval metrics, filter results, privacy issues, and per-case retrieval details, but not generation-grounding results or RAG-vs-no-RAG comparison aggregates. Issue #75 asks for retrieval and end-to-end grounding metrics plus a RAG comparison report.

Required fix:
- Extend the report to include grounding results, citation validation failures, benchmark validation failures, and RAG/no-RAG comparison metrics.
- Include per-case failure categories for corpus, retrieval, rule, prompt, contract, and localization/pattern leakage where applicable.
- Add a documented full-suite command that writes the machine-readable report artifact.

11. Approval/revision signals are declared but never populated

The report has `approved_count` and `revision_requested_count`, but `RetrievalEvalRunner` sets `approval_signal = None` for every case. That means the required approval/revision metrics cannot actually be reported.

Required fix:
- Either populate approval/revision signals from reviewed evaluation outcomes, or clearly mark these metrics as unavailable and remove them from acceptance claims until the data exists.
- If kept for issue #75, the dataset should contain review outcomes and the report should aggregate them from real case data.

12. Privacy tests inspect fixture JSON instead of stored/retrieved Qdrant payloads

The privacy tests upsert fixture points but then check the original fixture JSON. This does not prove the Qdrant serialization/retrieval boundary is safe.

Required fix:
- After upsert, read or search the stored Qdrant payloads and assert that Business Profile fields are absent there.
- Add a canary profile value and prove it does not appear in stored payloads, retrieved payloads, generated packs, or prompts.

Summary of expected correction:
- Make the evaluation suite pass.
- Remove xfailed acceptance behavior.
- Use real retrieval outputs for RAG comparison.
- Validate actual generated citations without mutating them.
- Enforce source governance on real source-reference fields.
- Expand reporting to include the end-to-end grounding and comparison metrics required by issue #75.
