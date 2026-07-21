# Marketing Knowledge Pack

Curated, decision-oriented marketing playbook corpus used by the MarketMind
AI Strategy step as retrieved knowledge. This directory is the **seed
corpus for issue [#68](https://github.com/ARabee3/marketmind-ai/issues/68)**
(part of parent [#66](https://github.com/ARabee3/marketmind-ai/issues/66)).

This is general marketing **knowledge**, not business-specific data:
no Business Profiles, private client data, generated Strategy plans, or
generated content live here.

## What's inside

- 30 entries across 10 categories (`frameworks`, `objectives`, `channels`,
  `benchmarks`, `content-strategy`, `budget-measurement`, `regional`,
  `sector-notes`, `policy`).
- `_schema/FRONT_MATTER_SCHEMA.md` — normative field-by-field front-matter
  spec.
- `_schema/TAXONOMY.md` — every controlled vocabulary list.
- `_schema/validate-knowledge.mjs` — authoring-time validator that checks
  every entry, computes SHA-256 checksums, resolves external source URLs,
  regenerates `MANIFEST.json`, and confirms the two intentional fixtures
  are unavailable for live retrieval.
- `MANIFEST.json` — auto-generated index (do not hand-edit; the validator
  regenerates it).
- `seed-retrieval-queries.json` — eval seed queries for the future RAG
  evaluation suite in
  [#75](https://github.com/ARabee3/marketmind-ai/issues/75).

Field names in the front matter deliberately mirror the Qdrant payload
shape in `services/ai/app/qdrant/schemas.py` so that ingestion
([#71](https://github.com/ARabee3/marketmind-ai/issues/71)) needs no field
renaming — only chunking, embedding, and Postgres ID assignment.

## How to add a new entry

1. Pick a stable kebab-case `slug` that equals the filename (without
   `.md`). Slugs are forever; never rename.
2. Copy the front-matter template in `_schema/FRONT_MATTER_SCHEMA.md`.
3. Fill every controlled-vocabulary field from `_schema/TAXONOMY.md`. Use
   `[]` for arrays that don't apply — never omit a key.
4. Set `version: 1`, `review_status: draft`, `reviewer: null`,
   `reviewed_at: null`, and `checksum: ""` (the validator computes it).
5. Write the body using the required section structure for your `kind`
   (see `FRONT_MATTER_SCHEMA.md` references and existing entries). Every
   entry must include an explicit poor-fit condition.
6. Cite real `source_references` for any numeric or factual claim. The
   literal `internal:reviewed-marketing-methodology` reference is allowed
   **only** for non-factual framework/methodology explanations — never as
   the citation for a numeric claim. Never invent a number; if none is
   available, record the gap (see
   `budget-measurement/engagement-rate-benchmark-caveat.md`).
7. Run `npm run check:marketing-knowledge`. Fix every reported issue.
   The validator writes the `checksum` back into your file and regenerates
   `MANIFEST.json`.
8. Open the entry for review (still `draft`). Only after both required
   reviewers have explicitly approved the content, flip `review_status`
   to `approved` and fill in `reviewer` (GitHub handle, no `@`) and
   `reviewed_at` (ISO date), then re-run the validator and commit.

## Review workflow

Every entry starts as `draft`. Live retrieval packs may only ever contain
`approved` entries with non-null `reviewer`/`reviewed_at`. Self-approval is
not allowed — see the governance policy under `policy/`.

See `Docs/ISSUE_68_IMPLEMENTATION_PLAN.md` §8 for the full review workflow.