# Strategy Agent Contract

This is the canonical contract documentation for the MarketMind Strategy Agent (Issue #67).

The Strategy Agent connects the confirmed Business Profile with owner budget/goals to generate a structured, deterministically scored marketing plan.

## 1. Flow Overview

1. **Intake**: Owner submits a `StrategyBrief` referencing a confirmed `BusinessProfileVersion`.
2. **Retrieval**: The system queries the Qdrant `marketing_knowledge_v1` collection to build a `RetrievedKnowledgePack`.
3. **Planning**: The AI combines the brief, the immutable profile reference, and the retrieval pack to generate a `StrategyPlan`.
4. **Validation**: The plan must pass strict constraints (channel limits, budget arithmetic, 12-week roadmap, 3-5 pillars) enforced at the schema level.
5. **Review**: The owner reviews the plan and submits an `OwnerDecision` (approved, rejected, or revision_requested).

## 2. Shared Types

- `ContractVersionLiteral`: Always `"strategy-v1"`
- `CurrencyCodeLiteral`: Always `"EGP"`
- `BusinessProfileVersionRef`: Reference to the confirmed business profile used (`business_profile_version_id`, `version`, `confirmed_at`).

## 3. Core Models

### 3.1. StrategyBrief
The initial owner input for the strategy phase.
- **`primary_objective`**: `awareness`, `acquisition`, `conversion`, `retention`, or `launch`
- **`external_budget_mode`**: `organic_only`, `monthly_amount`, `three_month_amount`, or `scenario_only`
- **`paid_media_allowed`**: Boolean. If `false`, budget mode must be `organic_only` or `scenario_only`.
- **`external_budget_egp`**: Must be a positive number if budget mode is monthly or three_month.

### 3.2. RetrievedKnowledgePack
The curated, privacy-minimized knowledge pack injected into the AI context.
- **`items`**: `RetrievedKnowledgeItem` elements with relevance scores and `SourceQuality` limits.
- **`knowledge_gaps`**: Identified missing context areas.
- **`retrieval_metadata`**: Including embedding dimensions, provider, latency, and `collection_name` (`marketing_knowledge_v1`).

### 3.3. StrategyPlan
The deterministically validated output from the Strategy Agent.
- **Provenance**: Every AI generated claim is wrapped in a `SourcedClaim`, recording its origin (`owner_input`, `retrieved_evidence`, `deterministic_result`, etc.) and `citation_ids` pointing to the retrieval pack.
- **Channel Limits**: At most 2 `primary` channels and 1 `supporting` channel.
- **Budget Validation**: Channel allocations must sum to `total_egp` exactly.
- **Roadmap Constraint**: Content strategy must contain 3-5 pillars and exactly 12 weeks.
- **Benchmarks**: If a KPI uses `verified_benchmark_range`, a `benchmark_citation_id` is required.

## 4. Lifecycle & Events

The Strategy flow emits `StrategyProgressEvent` messages over WebSocket:
- **`stage`**: `queued`, `query_planning`, `retrieval`, `generating`, `validating`, `ready`, `failed`.
- **`status`**: `started`, `progress`, `complete`, `failed`.

Allowed state transitions are strictly governed:
- `needs_brief` -> `ready`
- `ready` -> `retrieving`
- `retrieving` -> `queued`
- `queued` -> `generating`
- `generating` -> `validating`
- `validating` -> `draft`
- `draft` -> `approved` | `rejected`

## 5. Errors
All Strategy error codes start with `STRATEGY_`. Examples:
- `STRATEGY_BRIEF_INVALID`: Brief fails validation.
- `STRATEGY_PROFILE_STALE`: Brief references an outdated profile version.
- `STRATEGY_BUDGET_MISMATCH`: Budget allocations don't sum to total.
- `STRATEGY_CHANNEL_LIMIT_EXCEEDED`: Too many primary/supporting channels.
