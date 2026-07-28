# Evaluation Dataset Authoring Guide

## Field-by-field guide

### `RetrievalQueryInput`
The privacy-minimized fields sent to Qdrant for building the retrieval query.

| Field | Required | Notes |
|---|---|---|
| `business_type` | Yes | e.g. "retail", "restaurant", "clinic" |
| `market` | Yes | Always "egypt" for MarketMind scope |
| `locale` | Yes | "ar-EG", "en", or "mixed" |
| `objective` | Yes | One of StrategyObjective enum values |
| `funnel_stage` | Yes | Funnel stage string |
| `active_channels` | Yes | e.g. ["instagram", "facebook"] |
| `asset_capability` | Yes | e.g. ["photos", "videos"] |
| `team_capacity` | Yes | Free-text description |
| `budget_mode` | Yes | ExternalBudgetMode enum value |
| `industry` | No | Nullable |
| `paid_media_allowed` | No | Defaults to `true` |

### `ExpectedRetrieval`

| Field | Required | Notes |
|---|---|---|
| `expected_chunk_ids` | Yes | At least one must appear in top-5 results. Must reference real chunk_ids from the ingested knowledge pack. |
| `forbidden_chunk_ids` | Yes | Must never appear in results regardless of score. Includes expired, unapproved, wrong-locale chunks. |
| `required_gap_categories` | Yes | Must appear in knowledge_gaps when the knowledge category is missing from results. |
| `min_top5_hit_rate` | No | Per-case override of default 80% threshold. |

### `HardFilterCase`

| Field | Required | Notes |
|---|---|---|
| `chunk_id` | Yes | Chunk ID that should be filtered out |
| `filter_reason` | Yes | "expired" \| "unapproved" \| "future_effective" \| "incompatible_locale" \| "incompatible_sector" |

### `EvalCase`

| Field | Required | Notes |
|---|---|---|
| `id` | Yes | Unique identifier, e.g. "retail-ar-awareness-001" |
| `sector` | Yes | "retail" \| "hospitality" \| "services" \| "education" \| "healthcare" |
| `language` | Yes | "ar-EG" \| "en" \| "mixed" |
| `description` | Yes | Human-readable scenario |
| `query_input` | Yes | RetrievalQueryInput object |
| `expected_retrieval` | Yes | ExpectedRetrieval object |
| `hard_filter_cases` | Yes | List of HardFilterCase |
| `reviewer` | Yes | GitHub handle |
| `reviewed_at` | Yes | ISO date string |

## How to pick `expected_chunk_ids`

1. Run the retrieval query against the ingested Qdrant collection using the fake embedding provider.
2. Identify which chunk_ids are correct for the business scenario (same sector, locale, objective).
3. Add the most relevant ones to `expected_chunk_ids`.
4. Have a human reviewer confirm correctness.

## How to identify `forbidden_chunk_ids`

- **Expired**: chunk_id where `expires_at < now`
- **Unapproved**: chunk_id where `review_status != "approved"`
- **Wrong locale**: chunk_id where `locale` doesn't match the requested locale
- **Wrong sector**: chunk_id where `industries` tag doesn't match the requested sector

## Case review checklist

- [ ] Case represents a real SME scenario within Sprint 4 scope
- [ ] `expected_chunk_ids` exist in the ingested knowledge pack
- [ ] `forbidden_chunk_ids` have verifiable reasons (expired, wrong locale, etc.)
- [ ] Query context excludes PII (no owner name, address, phone, email)
- [ ] Hard filter cases are reproducible with deterministic fixtures
- [ ] Language tags match the actual content locale
- [ ] Case has been functionally tested before commit

## Running the evaluation suite

**Smoke subset (fast CI, no external calls):**
```bash
uv run pytest tests/evaluation -m eval_smoke -v
```

**Full evaluation suite (no database required):**
```bash
uv run pytest tests/evaluation -m eval_full -v
uv run python -m tests.evaluation.run_evaluation --suite full --report-file evaluation_report.json
```

**PostgreSQL citation persistence proof:**
```bash
npm run docker:up
cd services/ai && uv run pytest tests/evaluation/test_persistence_resolution.py -q
```
