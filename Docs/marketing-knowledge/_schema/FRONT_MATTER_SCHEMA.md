# Front-Matter Schema

Every entry in `Docs/marketing-knowledge/` is a Markdown file with YAML
front matter. This document is the normative, field-by-field specification.
The authoring validator (`_schema/validate-knowledge.mjs`) enforces every
rule here; do not hand-edit fields the validator owns (notably `checksum`).

## Field-by-field spec

```yaml
---
slug: channel-facebook                    # kebab-case, stable forever, = filename (without .md)
version: 1                                 # integer, starts at 1, bump on real content change
kind: channel_playbook                     # see KIND enum in TAXONOMY.md
title: "Facebook Fit, Poor-Fit, and Measurement Guide"   # short human title
summary: >                                 # one-paragraph plain-language summary
  When Facebook is a useful primary/supporting channel for an Egyptian SME,
  when it is a poor fit, required assets, and how to measure it.
locale: mixed                              # ar-EG | en | mixed  (see TAXONOMY.md)
markets: [egypt, mena]                     # see TAXONOMY.md — do not use "egypt" for global claims
industries: [general]                      # subset of the 6 approved INDUSTRIES values only
business_models: [qsr, food_beverage]      # free-form secondary tags, NOT hard-filtered, recall-only
objectives: [awareness, acquisition]       # subset of OBJECTIVES exactly
funnel_stages: [awareness, consideration]  # subset of FUNNEL_STAGES in TAXONOMY.md
channels: [facebook]                       # subset of the 6 CHANNELS slugs
seasons: []                                # subset of SEASONS in TAXONOMY.md, [] if evergreen
budget_modes: [organic_only, monthly_amount]  # subset of BUDGET_MODES exactly
evidence_tier: reviewed_guidance           # verified_benchmark | reviewed_guidance | contextual_note
review_status: draft                       # draft while authoring; flip to approved only after human review (§8)
source_references:                         # real URLs, or "internal:reviewed-marketing-methodology"
  - "https://example.com/real-source"
effective_at: "2026-07-21"                 # ISO date, today or the source's real publish date
expires_at: null                           # ISO date or null; null only for evergreen methodology
author: "abdulazimRabie"                   # GitHub handle, no @
reviewer: null                             # GitHub handle, filled in when review_status becomes approved
reviewed_at: null                          # ISO date, filled in when review_status becomes approved
checksum: ""                               # leave empty; the validator computes and fills this in
---
```

## Rules

- `id`, `entry_id`, and `chunk_id` from the Qdrant schema
  (`services/ai/app/qdrant/schemas.py`) are **deliberately absent** from
  front matter. Postgres (issue `#69`) assigns the real UUID at ingestion
  time. Do not invent a UUID here — it would be a fake stable identity that
  `#69`'s migration would have to detect and discard.
- `review_status` starts as `draft` for every authored entry. Only the two
  required human reviewers can flip an entry to `approved` (see
  `../README.md` review workflow). Do not self-approve.
- Arrays that don't apply to an entry must be `[]`, not omitted — the
  validator rejects missing keys.
- `checksum` = SHA-256 of the normalized Markdown body (trailing whitespace
  trimmed, LF line endings), lowercase hex, computed and written by the
  validator script, never by hand.
- `slug` must equal the filename without `.md` and must be unique across the
  whole corpus.
- `expires_at` may be `null` only for evergreen methodology; numeric
  benchmark entries and any seasonal entry must carry a real expiry date.
  When `expires_at` is non-null it must be a valid ISO date on or after
  `effective_at`.
- `source_references` must contain at least one entry. Real `https://` URLs
  are resolved by the validator (HEAD, falling back to GET) and a 4xx/5xx
  or timeout fails the run. The literal `internal:reviewed-marketing-methodology`
  reference is exempt from URL resolution and is allowed only for
  non-factual framework/methodology explanations, never for a numeric claim.