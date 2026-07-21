# Controlled Taxonomy

All controlled vocabularies for `Docs/marketing-knowledge/` front matter.
Every value used in an entry's front matter must come from the lists below.
The authoring validator (`validate-knowledge.mjs`) enforces these exactly.

## KIND (pick exactly one per entry)

```text
framework | objective_playbook | channel_playbook | benchmark_report |
content_strategy_playbook | budget_playbook | measurement_playbook |
regional_guidance | sector_note | policy
```

## LOCALE

```text
ar-EG | en | mixed
```

## MARKETS

```text
egypt | mena | global
```

Rule: `global` must be used whenever the source is not Egypt/MENA-specific.
Never mark a global source `egypt` to make an entry look more locally
relevant.

## INDUSTRIES (hard-filtered, exactly these 6)

```text
retail | hospitality | services | education | healthcare | general
```

These match the issue's required sectors. `general` is used when an entry
applies across all industries.

## BUSINESS_MODELS (free-form, recall-only, NOT hard-filtered)

These are examples, not an exhaustive enum — the validator does not enforce
membership. They exist for recall-only secondary filtering:

```text
qsr, food_beverage, ecommerce, clinic, salon, tutoring_center, gym,
professional_services, home_services, cafe, bakery
```

## OBJECTIVES (must exactly match `packages/contracts` STRATEGY_OBJECTIVES)

```text
awareness | acquisition | conversion | retention | launch
```

Source: `packages/contracts/src/strategy/strategy-brief.ts`.

## FUNNEL_STAGES

```text
awareness | consideration | conversion | retention | advocacy
```

## CHANNELS (canonical slugs — this corpus is the source of truth)

```text
facebook | instagram | tiktok | google_business_profile | website | delivery_platforms
```

Note: an older contract fixture used `google_maps` for this channel. That
fixture is legacy/synthetic; `google_business_profile` is the current
canonical slug going forward. Do not use `google_maps` in new entries.

## SEASONS

```text
ramadan | eid_al_fitr | eid_al_adha | back_to_school | summer | winter_holidays
```

Use `[]` for evergreen entries — do not force a season tag.

## BUDGET_MODES (must exactly match `packages/contracts` EXTERNAL_BUDGET_MODES)

```text
organic_only | monthly_amount | three_month_amount | scenario_only
```

Source: `packages/contracts/src/strategy/strategy-brief.ts`.

## EVIDENCE_TIER (must exactly match `packages/contracts` EVIDENCE_TIERS)

```text
verified_benchmark | reviewed_guidance | contextual_note
```

Source: `packages/contracts/src/strategy/strategy-retrieval.ts`.

- `verified_benchmark` — a single-methodology, currently-valid, cited
  numeric source. Very few entries qualify.
- `reviewed_guidance` — team-synthesized, decision-oriented advice, not a
  specific external factual claim.
- `contextual_note` — lower-confidence context: sector color, caveats, open
  discrepancies. Use this liberally rather than upgrading a shaky claim to
  `reviewed_guidance`.

## REVIEW_STATUS

```text
draft | approved | retired | expired
```

`draft` while authoring; `approved` only after the two required human
reviewers have explicitly reviewed the content; `retired`/`expired` for
lifecycle management later.