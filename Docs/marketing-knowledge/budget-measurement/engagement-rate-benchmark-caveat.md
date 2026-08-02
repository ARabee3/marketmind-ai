---
slug: engagement-rate-benchmark-caveat
version: 3
kind: measurement_playbook
title: Engagement-Rate / CPC / CPM Benchmark Caveat
summary: >
  A documented corpus gap: this review did not accept a methodology-transparent
  Egypt-specific engagement-rate, CPC, or CPM benchmark. Use the owner's own
  baseline or target unless a compatible reviewed benchmark is added.
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
funnel_stages:
  - awareness
  - consideration
channels: []
seasons: []
budget_modes: []
evidence_tier: contextual_note
review_status: approved
source_references:
  - 'https://www.rivaliq.com/blog/social-media-industry-benchmark-report/'
  - 'https://www.socialinsider.io/blog/social-media-engagement-rates/'
effective_at: '2026-07-21'
expires_at: '2027-07-21'
author: abdulazimRabie
reviewer: mostafamerzk
reviewed_at: '2026-08-02'
checksum: de7ef5b069dcc649aa487593dd9049be4fb5e5fde1d7312f5aa02e1f4c489e04
---

## When useful

Use this entry whenever a plan is tempted to set an engagement-rate, CPC,
or CPM target from a published global benchmark, or whenever the Strategy
step needs to produce a `knowledge_gaps[]` item for these metrics instead
of inventing a number. This is the entry that lets the Strategy Agent
honestly say "no approved Egypt benchmark is available in this corpus" rather than silently
omitting the topic or pasting a plausible figure.

## Poor-fit conditions

Do not use this entry as cover to skip measurement entirely — the absence
of a verified benchmark is not an excuse to avoid baselines; use the
`establish_baseline` or `owner_target` KPI modes from
`kpi-modes-and-vanity-vs-business-metrics.md`. Also do not use it to claim
"engagement doesn't matter"; it does, but only relative to the owner's own
baseline, not to a global number.

## Required inputs

- The metric being considered (engagement rate, CPC, or CPM).
- The source being proposed (if any) and its stated methodology.
- Whether the source is Egypt-specific or global.

## The documented gap

**As of the corpus review on 2026-08-02, no methodology-transparent,
Egypt-specific engagement-rate, CPC, or CPM benchmark had been accepted into
this corpus.** Global reports use different samples, formulas, industries, and
reporting windows. That makes a single global figure a weak target for an
Egyptian SME unless the source, formula, sample, geography, and campaign type
match the plan.

The reports below are retained as examples of why methodology must be checked,
not as Egypt benchmarks. Applying a global figure as if it were Egypt-specific
would be the local-relevance fabrication the ground rules forbid.

## Worked micro-example (illustrative — not real figures)

> Illustrative only — the numbers below are placeholders to show
> decision shape, not real benchmarks.

Suppose a plan wants to set an Instagram engagement target. Instead of
quoting "0.4%", the plan sets: target mode `establish_baseline` for the
first two weeks, measuring the owner's own (likes+comments+saves)/followers
per post; then `owner_target` = a modest lift over that baseline by week
12. No external benchmark is cited as the reference, because this corpus has no
approved Egypt-specific entry for that metric. If a fresh, single-source, methodology-matched,
Egypt-specific figure is later retrieved and cited, a new
`verified_benchmark` entry may be authored to replace this caveat for
that specific metric.

## Sources

- Rival IQ social media industry benchmark report: https://www.rivaliq.com/blog/social-media-industry-benchmark-report/
- Socialinsider social media engagement rates: https://www.socialinsider.io/blog/social-media-engagement-rates/
- `internal:reviewed-marketing-methodology` for the decision rule (use
  baseline/owner-target KPI modes).
