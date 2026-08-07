# Marketing Knowledge Live-Readiness

This record separates **technical retrieval readiness** from the remaining
human-review gate. It must never be used to imply that an outstanding reviewer
has approved the corpus.

## Verified technical state — 2026-08-07

- Source entries: 32
- Runtime-eligible entries: 32 — each current entry front matter has
  `review_status: approved`, a non-empty `reviewer`, and a `reviewed_at` date.
- Committed ingestion: run `18b2d294-7036-4907-a069-ccfa57820dbd` succeeded
  against commit `2314437f3bd0f27c825bd4a8045806fb73a0a3dd`; 32 entries and 64
  chunks were written with 0 failed entries.
- Live collection: `marketing_knowledge_gemini_2_v1`
- Embeddings: Gemini `gemini-embedding-2`, 768 dimensions
- Controlled selection mode: `semantic_mmr`, `mmr_lambda=0.5`. The product
  default remains `semantic`; this record is not permission to silently change
  a deployed environment.

The corpus was checked with `npm run check:marketing-knowledge` before the
live replay.

## Retained live replay evidence

The following runs used a clearly marked fictional local business profile. No
customer data, credentials, or unpublished business facts were used. The API,
PostgreSQL persistence, Qdrant collection, Gemini embedding provider, and
Strategy service were all real local integration components.

| Evidence | Reference | Result |
| --- | --- | --- |
| Arabic framework-diagnosis retrieval | `6cb9c2e8-3516-4123-813b-e6dd1edc9e13` | Completed; 8 items, 1 non-critical `objective_funnel` gap; approved framework, channel, content-strategy, regional, and measurement evidence retained. |
| Arabic Strategy generation | Strategy `8ca9fec5-5a10-4008-b880-4125e04b5740`, version `db0afc51-8324-4212-9fb7-62277fda1c8c` | Draft version 1 persisted from the Arabic retrieval pack after deterministic scoring and validation. |
| English framework-diagnosis retrieval | `8efbdaa6-55c0-4f3b-beff-0e04b551ef1f` | Completed; 8 items, 1 non-critical `objective_funnel` gap; approved framework, channel, content-strategy, regional, and measurement evidence retained. |

Both retrieval runs persisted `selection_mode: semantic_mmr`,
`embedding_model: gemini-embedding-2`, `embedding_dimensions: 768`, and the
collection name above. In each run, `framework_diagnosis` included the approved
*Situation and Bottleneck Diagnosis for SME Strategy* entry. The retained
`objective_funnel` gap is visible rather than hidden; it was non-critical and
did not block the Arabic Strategy draft.

## Human approval result

For Issue #103, the team reviewed the two framework entries and delegated one
accountable final sign-off to Ahmed (`ARabee3`). Ahmed completed that approval
on 2026-08-07. `npm run strategy:readiness` therefore verifies that final
approval, entry metadata, and the retained live evidence above.

This does not claim that every teammate personally signed an approval box, and
it does not change the broader #68 entry-review tracking in
[APPROVAL_RECORD.md](APPROVAL_RECORD.md). The final human/live QA gate remains
issue [#128](https://github.com/ARabee3/marketmind-ai/issues/128).

## Re-run procedure

For a future demo or release candidate, retain the resulting run IDs and verify
all of the following before updating this file:

1. `npm run check:marketing-knowledge` passes.
2. The selected environment records its provider, model, dimensions, collection,
   and selection mode.
3. One Arabic and one English `framework_diagnosis` retrieval complete using
   only approved entries.
4. A Strategy generation persists an immutable version from its retrieval run.
5. Any `KnowledgeGap` is recorded truthfully, and no reviewer approval is
   inferred.
