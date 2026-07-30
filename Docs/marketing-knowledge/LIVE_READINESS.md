# Marketing Knowledge Live-Readiness

This pack is authored and schema-valid, but it is **not live-retrieval ready**
until the required human reviews are complete.

## Current state

- Entry count: 32
- Approved entries: 0
- Live-retrievable entries: 0
- Current manifest status: all entries are `draft`

This is intentional while PR review is pending. The Strategy retrieval pipeline
must only index entries where:

1. `review_status` is `approved`;
2. `reviewer` is non-null;
3. `reviewed_at` is non-null;
4. `effective_at <= today`;
5. `expires_at` is null or in the future.

## Required before closing issue #68

- Ahmed (`ARabee3`) reviews the seed corpus.
- Merzek (`mostafamerzk`) reviews the seed corpus.
- Gerges (`GergesYoussef-hub`) reviews retrieval-facing metadata and examples.
- Approved entries are flipped from `draft` to `approved`.
- The approval record is updated.
- `npm run check:marketing-knowledge` passes after the approval updates.

Do not mark entries approved from automation alone. Human review is the approval
gate for this corpus.

## Issue #103 framework-diagnosis gate

The source-backed revisions to `situation-diagnosis-5cs-swot` and
`smart-objectives-funnel-mapping` remain `draft` until Ahmed, Merzek, and Gerges
complete the approval checklist above. After approval, re-run corpus validation,
ingest the approved versions into PostgreSQL/Qdrant, and run the Arabic and
English `framework_diagnosis` retrieval smoke cases. Issue #103 must remain open
until both live cases retrieve the approved framework and Strategy generation no
longer emits the blocking `MISSING_FRAMEWORK_DATA` gap.
