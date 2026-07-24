---
slug: governance-approval-citation-and-limits-policy
version: 1
kind: policy
title: 'Governance: Approval, Citation, and Limits Policy'
summary: >
  The corpus-level policy that every knowledge entry must be approved before
  live retrieval, that every numeric claim must be cited and tier-honest, and
  that channel/budget/plan structure respects code-enforced limits already
  guaranteed by validators.
locale: en
markets:
  - global
industries:
  - general
business_models: []
objectives:
  - awareness
  - acquisition
  - conversion
  - retention
  - launch
funnel_stages: []
channels: []
seasons: []
budget_modes: []
evidence_tier: reviewed_guidance
review_status: draft
source_references:
  - 'internal:reviewed-marketing-methodology'
effective_at: '2026-07-21'
expires_at: null
author: abdulazimRabie
reviewer: null
reviewed_at: null
checksum: 0b8b4a5a02b157a62d25fca24fd1480cfd260b00018c6e8e5ac546f4a9b66319
---

## The rule in plain language

Corpus policy for `Docs/marketing-knowledge/`:

1. **Approval gate.** no entry may appear in a live retrieval pack unless
   its `review_status` is `approved`, with a non-null `reviewer` and
   `reviewed_at`. Draft entries are authoring-only and must never reach a
   Strategy plan as cited knowledge.
2. **Citation honesty.** every external factual or numeric claim must have
   a real `source_references` URL that resolves, and an `evidence_tier` that
   honestly reflects the strength of the source. Numeric claims requiring a
   single-methodology verified source may only use
   `verified_benchmark`; team-synthesized decision guidance uses
   `reviewed_guidance`; lower-confidence context and caveats use
   `contextual_note`. `internal:reviewed-marketing-methodology` is allowed
   only for non-factual framework/methodology explanations — never as the
   citation for a numeric claim.
3. **Freshness.** time-sensitive numeric entries (benchmark reports,
   seasonal entries) carry real `effective_at` and `expires_at` dates;
   evergreen methodology may use `expires_at: null`. Expired entries must
   not be served as live knowledge.
4. **No business-specific data.** no Business Profiles, private client
   data, generated Strategy plans, or generated content may appear in the
   corpus — the corpus is general marketing knowledge only.
5. **Knowledge-gap honesty.** when a verified number is unavailable, the
   Strategy step must emit a `knowledge_gaps[]` item rather than invent a
   plausible figure (the `engagement-rate-benchmark-caveat` entry exists
   to make this concrete).

## Why it exists

The Strategy Agent and downstream Content Agent can produce fluent,
plausible output regardless of evidence. Without an enforced approval,
citation, and tier-honesty policy, an SME plan can quietly cite a
non-existent benchmark, label global guidance as Egyptian, or treat a
draft entry as approved — each of which undermines owner trust and
produces plans nobody can defend. The policy is the floor of
honesty the system must hold regardless of what any single AI agent emits.

## What is code-enforced vs. guidance-only

Some limits are additionally guaranteed by code and the corpus entries
should not claim sole responsibility for them — they are belt-and-braces,
not the only guardrail:

- **Channel plan limit (code-enforced).** `packages/contracts/src/
  strategy/strategy-policy.ts` rejects a plan with more than two primary
  channels or more than one supporting channel (the "2+1" limit). This
  entry's guidance ("plans mix at most 2 primary + 1 supporting channel")
  must be understood as a restatement of an already-enforced rule, not
  the source of enforcement.
- **Budget-mode plan validation (code-enforced).** the same validator
  excludes paid-spend scenarios when `paid_media_allowed` is false, and
  validates that budget scenario amounts fall within the brief's
  declared EGP min/max range. Corpus budget entries must not claim to
  authorise spend the validator already forbids.
- **12-week plan structure (code-enforced).** the validator requires
  exactly 12 week entries; corpus cadence guidance is written to that
  exact window and should not propose plans outside it.
- **Channel score dimensions (code-enforced).** channel score totals are
  reproducible from eight bounded deterministic dimensions (0–1 each);
  the channel playbooks here describe *fit and decision guidance*, not
  the deterministic scores themselves.

The following are **guidance-only** (not mirrored by code, so the corpus
is the source of truth and the Strategy Agent must respect them):

- **Approval gate above** (the validator ensures draft entries aren't
  flagged approved without reviewer fields, but the human review itself
  is the real gate and is enforced by the workflow in `../README.md`, not
  by code).
- **Citation honesty and tier honesty** — the authoring validator checks
  URLs resolve and that tiers are valid enum values; it does not verify
  that a tier is *appropriate* for the strength of a given claim. That
  judgement is the author's and reviewer's responsibility.
- **No-business-data and knowledge-gap honesty** — these are policy and
  review rules, not machine-enforced.

## Sources

- `internal:reviewed-marketing-methodology` — corpus governance policy
  aligned with the architecture doc and `AGENTS.md` ground rules.
- Code-enforced cross-references in
  `packages/contracts/src/strategy/strategy-policy.ts`
  (`calculateChannelTotal`, `validateStrategyBundle`).
