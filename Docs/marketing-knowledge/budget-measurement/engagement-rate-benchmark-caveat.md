---
slug: engagement-rate-benchmark-caveat
version: 1
kind: measurement_playbook
title: Engagement-Rate / CPC / CPM Benchmark Caveat
summary: >
  A documented knowledge gap: no reliable Egypt-specific engagement-rate, CPC,
  or CPM benchmark exists, and the global figures that do exist disagree by an
  order of magnitude depending on methodology. Treat any externally-quoted
  figure as unverifiable and use baseline/owner-target KPI modes instead.
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
review_status: draft
source_references:
  - 'https://www.rivaliq.com/blog/social-media-industry-benchmark-report/'
  - 'https://www.socialinsider.io/blog/social-media-engagement-rates/'
effective_at: '2026-07-21'
expires_at: '2027-07-21'
author: abdulazimRabie
reviewer: null
reviewed_at: null
checksum: bc637df57e5611599a1112c58387e5e542a7aae085b94b18112b72f1147a6a1a
---

## When useful

Use this entry whenever a plan is tempted to set an engagement-rate, CPC,
or CPM target from a published global benchmark, or whenever the Strategy
step needs to produce a `knowledge_gaps[]` item for these metrics instead
of inventing a number. This is the entry that lets the Strategy Agent
honestly say "no verified Egypt benchmark available" rather than silently
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

**No Egypt-specific engagement-rate, CPC, or CPM benchmark was found in
the research for this corpus.** The global figures that do exist disagree
by an order of magnitude depending on methodology. For example, **Rival IQ
reports a 0.30% median Instagram engagement rate by followers**, while
**Socialinsider reports 0.48% using the same "by followers" formula on a
different sample** — same metric, same platform, same window, two
publishers, ~1.6x apart. At the industry level, comparisons between
publishers reporting on the same platform in the same year can differ by
**more than 10x**, driven entirely by sample composition (which accounts
are included, follower-size buckets, public vs. private, geography).

These disagreements are not minor rounding; they mean a single externally
quoted engagement/CPC/CPM number is not a stable reference point — using it
to set a target or to claim "we beat benchmark" would be a methodology
error, and applying a global figure as if it were Egypt-specific would be
the local-relevance fabrication the ground rules forbid.

## Worked micro-example (illustrative — not real figures)

> Illustrative only — the numbers below are placeholders to show
> decision shape, not real benchmarks.

Suppose a plan wants to set an Instagram engagement target. Instead of
quoting "0.4%", the plan sets: target mode `establish_baseline` for the
first two weeks, measuring the owner's own (likes+comments+saves)/followers
per post; then `owner_target` = a modest lift over that baseline by week
12. No external benchmark is cited as the reference, because no Egypt-
specific one exists and the global ones disagree by enough to invalidate
the comparison. If a fresh, single-source, methodology-matched,
Egypt-specific figure is later retrieved and cited, a new
`verified_benchmark` entry may be authored to replace this caveat for
that specific metric.

## Sources

- Rival IQ social media industry benchmark report: https://www.rivaliq.com/blog/social-media-industry-benchmark-report/
- Socialinsider social media engagement rates: https://www.socialinsider.io/blog/social-media-engagement-rates/
- `internal:reviewed-marketing-methodology` for the decision rule (use
  baseline/owner-target KPI modes).
