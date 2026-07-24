---
slug: content-agent-handoff-boundary
version: 1
kind: content_strategy_playbook
title: Content Agent Handoff Boundary
summary: >
  Where the Strategy step's content plan stops and the Content Agent's
  generation starts, so no agent silently produces finished, published posts and
  the owner always approves before anything goes live.
locale: mixed
markets:
  - egypt
  - mena
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
checksum: 2af8015e3e93007108c3f321ee20ff2608fac6012f14c675a30e6201ae50493d
---

## When useful

Use this playbook to draw the explicit boundary downstream whenever the
Strategy step produces a plan that the Content Agent will turn into drafts.
It is always useful, because the boundary is the rule that keeps the system
honest: planning is one job, drafting is a second, approval is a third, and
publishing (explicit owner approval) is a fourth.

## Poor-fit conditions

There is no scenario where this boundary should not be drawn; it is a
rule, not an option. The only "poor fit" is mis-treating a low-stakes post
as exempt from the rule (a quick story still counts).

## Capacity implications

The boundary itself is capacity-neutral. The constraint to keep is: the
Strategy step and the Content Agent are different roles, and the owner is
the explicit approver between drafting and publishing. The Strategy step
hands the Content Agent a frame (objectives, audience, pillars, cadence,
channels, language, seasonal timing) and the Content Agent returns drafts;
it does not return anything published.

## How it hands off to the Content Agent

Concretely, the Strategy step produces:

- the chosen objective and its SMART metric;
- the target segment and positioning line from STP;
- the chosen channel(s);
- two-to-three content pillars;
- a cadence tier (posts/week, reels/week);
- language and seasonal timing (from
  `regional-language-tone-and-seasonal-calendar`);
- the measurement KPI and baseline.

The Strategy step must NOT produce final captions, scripts, image assets,
or scheduled posts. The Content Agent receives the frame above and returns
drafts (caption text, reel/script outlines, suggested image descriptions),
clearly labelled as drafts, for owner review. The owner approves before any
publishing — and publishing requires explicit owner approval per the
project's owner-approval gates; simulated/demo content must be clearly
labelled, never presented as live organic output. There is no silent
auto-publish path.

## Sources

- `internal:reviewed-marketing-methodology` — team-synthesized
  handoff-boundary guidance aligned with the architecture doc's owner
  approval gates and the project's "real publishing requires explicit owner
  approval" rule.
