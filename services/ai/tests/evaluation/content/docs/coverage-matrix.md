# Phase 2 — Baseline Coverage Matrix

Dataset version: `content-eval-baseline-v1`  
Schema version: `content-eval-v1`

## Summary

| Metric | Value |
| --- | --- |
| Total cases | 15 baseline |
| Sectors | 5 (hospitality, retail, services, education, healthcare) |
| Cases per sector | 3 |
| Language modes | ar, en, mixed (one per sector) |
| Passing cases | 12 |
| Hard-guardrail failure cases | 3 |
| Mutation cases | 19 (one per hard-guardrail target, including the health/regulated claim) |

## Case grid

| # | Case ID | Sector | Language | Week | Type | Expected result | Fixture reference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `hospitality-en-week1-baseline` | hospitality | en | 1 | Owner-confirmed baseline | pass | `content-pack-week-1-en.example.json` |
| 2 | `hospitality-ar-week2-consecutive` | hospitality | ar | 2 | Consecutive-week generation | pass | `content-pack-week-2-rollover.example.json` |
| 3 | `hospitality-mixed-week12-completion` | hospitality | mixed | 12 | Week-12 clean completion | pass | `content-pack-week-1-en.example.json` |
| 4 | `retail-ar-week1-owner-promotion` | retail | ar | 1 | Owner-approved promotion baseline | pass | `content-pack-week-1-ar.example.json` |
| 5 | `retail-en-week3-safe-default` | retail | en | 3 | Safe default context absent | pass | `content-week-context-safe-default.example.json` |
| 6 | `retail-mixed-week13-rejection` | retail | mixed | 13 | Week-13 hard rejection | **fail** | `content-week-13.invalid.json` |
| 7 | `services-mixed-week1-baseline` | services | mixed | 1 | No-promotion baseline | pass | `content-pack-week-1-mixed.example.json` |
| 8 | `services-ar-week4-consecutive` | services | ar | 4 | Consecutive-week generation | pass | `content-pack-week-2-rollover.example.json` |
| 9 | `services-en-week2-duplicate-claim` | services | en | 2 | Duplicate trigger collision | **fail** | `content-duplicate-week-claim.invalid.json` |
| 10 | `education-en-week1-baseline` | education | en | 1 | 5-item baseline | pass | `content-pack-week-1-en.example.json` |
| 11 | `education-ar-week5-safe-default` | education | ar | 5 | Safe default context absent | pass | `content-week-context-safe-default.example.json` |
| 12 | `education-mixed-superseded-cycle` | education | mixed | 2 | Stale/superseded cycle | **fail** | `content-cycle-paused.invalid.json` |
| 13 | `healthcare-ar-week1-baseline` | healthcare | ar | 1 | Regulated-claim-safe baseline | pass | `content-pack-week-1-ar.example.json` |
| 14 | `healthcare-mixed-week11-consecutive` | healthcare | mixed | 11 | Consecutive-week generation | pass | `content-pack-week-2-rollover.example.json` |
| 15 | `healthcare-en-week12-completion` | healthcare | en | 12 | Week-12 clean completion | pass | `content-pack-week-1-en.example.json` |

## Sector × language distribution

| Sector | ar | en | mixed |
| --- | --- | --- | --- |
| hospitality | `hospitality-ar-week2-consecutive` | `hospitality-en-week1-baseline` | `hospitality-mixed-week12-completion` |
| retail | `retail-ar-week1-owner-promotion` | `retail-en-week3-safe-default` | `retail-mixed-week13-rejection` |
| services | `services-ar-week4-consecutive` | `services-en-week2-duplicate-claim` | `services-mixed-week1-baseline` |
| education | `education-ar-week5-safe-default` | `education-en-week1-baseline` | `education-mixed-superseded-cycle` |
| healthcare | `healthcare-ar-week1-baseline` | `healthcare-en-week12-completion` | `healthcare-mixed-week11-consecutive` |

## Required rolling-cycle scenarios

| Scenario | Covered by | Expected result |
| --- | --- | --- |
| Consecutive-week generation (week N active → week N+1 draft) | `hospitality-ar-week2-consecutive`, `services-ar-week4-consecutive`, `healthcare-mixed-week11-consecutive` | pass |
| Safe default context absent | `retail-en-week3-safe-default`, `education-ar-week5-safe-default` | pass |
| Duplicate trigger collision (scheduler + manual + retry → one atomic claim) | `services-en-week2-duplicate-claim` | **fail** (`CONTENT_WEEK_ALREADY_CLAIMED`) |
| Stale/superseded cycle (new Strategy mid-cycle → old cycle stops) | `education-mixed-superseded-cycle` | **fail** (`CONTENT_CYCLE_PAUSED`) |
| Week-12 clean completion | `hospitality-mixed-week12-completion`, `healthcare-en-week12-completion` | pass |
| Week-13 hard rejection | `retail-mixed-week13-rejection` | **fail** (`CONTENT_WEEK_OUT_OF_RANGE`) |

## Synthetic data statement

All business names, owner names, handles, addresses, prices, offer terms, and
owner text are synthetic and fictional. No case references a real business,
real competitor, or real location. Handles are prefixed with `fictional` or
`demo`, business names carry a `— Fictional` suffix, and addresses use
"Demo District".

## Files

- `cases/cases_baseline_hospitality.json`
- `cases/cases_baseline_retail.json`
- `cases/cases_baseline_services.json`
- `cases/cases_baseline_education.json`
- `cases/cases_baseline_healthcare.json`
- `cases/generate_baseline_cases.py` — generator script that validates every case against the schema before writing
- `cases/test_baseline_cases.py` — matrix invariants tests

## Phase 2 acceptance

- [x] ≥15 cases authored
- [x] ≥3 cases per sector × 5 sectors
- [x] ar/en/mixed distributed (one per sector, not clustered)
- [x] All business data synthetic/fictional
- [x] Consecutive-week generation covered
- [x] Safe default context absent covered
- [x] Duplicate trigger collision covered
- [x] Stale/superseded cycle covered
- [x] Week-12 clean completion covered
- [x] Week-13 hard rejection covered
- [x] All cases validate against `content-eval-v1` schema
- [x] Matrix invariant tests pass