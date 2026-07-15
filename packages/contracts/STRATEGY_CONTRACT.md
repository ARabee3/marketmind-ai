# Strategy Agent Contract

This package is the canonical cross-service contract for Strategy Agent issue
#67. TypeScript defines the shared application types and executable policy;
Pydantic mirrors the consumer models. The same fixtures, policy mutations, and
snapshot checks run from the normal `@marketmind/contracts` check.

## Inputs stay separate

Strategy generation receives four distinct inputs:

1. the complete immutable confirmed `BusinessProfile` directly from NestJS;
2. the owner-controlled `StrategyBrief`;
3. the persisted `RetrievedKnowledgePack` produced by curated RAG;
4. deterministic channel scorecards.

The complete profile is never stored in or reconstructed from Qdrant. Only the
privacy-minimized `RetrievalQueryContext` is sent to knowledge retrieval.

`StrategyGenerateRequest` and `StrategyReviseRequest` encode this boundary for
the internal FastAPI endpoints. Public request types cover create, brief update,
generate/retry, decision submission, and Strategy resource reads.

## Version and identity semantics

- Contract version is always `strategy-v1`.
- Strategy, brief, profile-version, retrieval-run, and plan-version identities
  are separate.
- The profile ID, version number, and confirmation timestamp must match across
  the complete profile, brief, retrieval pack, and plan.
- Revision uses a new immutable plan version and retrieval run. It never mutates
  an approved or rejected version.

## Strategy Brief

- `primary_objective`: `awareness`, `acquisition`, `conversion`, `retention`, or
  `launch`.
- `external_budget_mode`: `organic_only`, `monthly_amount`,
  `three_month_amount`, or `scenario_only`.
- `external_budget_egp`: external marketing spend only. It accepts a positive
  owner amount or `{min_egp, max_egp}` range and is null for organic-only plans.
- `paid_media_allowed`: planning may not include paid-spend scenarios when this
  is false.
- `team_capacity`, constraints, and clarification answers remain owner inputs;
  they are not inferred from retrieval.

## Curated retrieval

A live `RetrievedKnowledgePack` contains only knowledge that is:

- approved;
- already effective at retrieval time;
- unexpired at retrieval time;
- hydrated from PostgreSQL after Qdrant candidate selection.

Valid evidence tiers are `verified_benchmark`, `reviewed_guidance`, and
`contextual_note`. Model synthesis is plan provenance, never library evidence.
Every plan citation must resolve exactly to an item in the persisted pack by
chunk ID, entry ID, entry version, and evidence tier.

## Deterministic channel policy

`strategy-channel-score-v1` scores eight dimensions from 0 through 1:

- objective fit;
- audience fit;
- existing presence;
- asset/format fit;
- team capacity;
- budget fit;
- evidence strength;
- measurement readiness.

Version 1 uses the rounded sum of those dimensions, producing a total from 0
through 8. `selected_channels` must reuse entries from `all_channel_scores`
without changing numbers. A plan may select at most two primary and one
supporting channel. The LLM may explain a score but cannot modify it.

## Budget, roadmap, KPI, and approval rules

- Scenario amounts are EGP external spend and declare whether they cover one
  month or the full 12-week period.
- Allocation amounts must equal the scenario total and percentages must equal 100.
- The base scenario equals the owner-confirmed amount. A scenario above that
  amount is clearly marked `requires_owner_budget_approval`; plan approval is
  guidance and never authorizes spending.
- Content strategy contains three to five pillars and each week number 1–12
  exactly once.
- `verified_benchmark_range` requires a target value and a citation that resolves
  to a current retrieved `verified_benchmark` item.
- Assumptions, risks, knowledge gaps, and blockers are separate arrays.
- A blocking gap, blocker, stale profile, invalid citation, invalid score, or
  arithmetic failure prevents an `approved` owner decision.

## Lifecycle

```text
needs_brief -> ready -> retrieving -> queued -> generating -> validating
             -> draft -> approved | rejected | failed
```

`revision_requested` is an owner decision. It returns the Strategy journey to
`ready` and produces a new immutable version after a new retrieval run.

## Stable validation errors

The shared error registry and `StrategyValidationIssue` use stable codes such
as:

- `STRATEGY_PROFILE_STALE`;
- `STRATEGY_EVIDENCE_NOT_APPROVED`;
- `STRATEGY_INVALID_CITATION`;
- `STRATEGY_INVALID_BENCHMARK`;
- `STRATEGY_SCORE_MISMATCH`;
- `STRATEGY_BUDGET_MISMATCH`;
- `STRATEGY_ARITHMETIC_FAILURE`;
- `STRATEGY_CHANNEL_LIMIT_EXCEEDED`;
- `STRATEGY_APPROVAL_BLOCKED`.

Each executable policy issue includes a stable code, field path, and safe
message. HTTP layers map those issues into the repository error envelope.

## Fixture policy

Koshary Corner and every other example business are fictional. Any benchmark
or market number used to test citation behavior is labeled
`[SYNTHETIC FIXTURE]` and uses a `synthetic-fixture://` source reference. Fixture
values are never approved MarketMind knowledge and must not be ingested.
