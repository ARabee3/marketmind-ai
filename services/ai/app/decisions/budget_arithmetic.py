"""Budget scenario computation and exact allocation arithmetic."""

from __future__ import annotations

from strategy_contracts import (
    BudgetScenario,
    ChannelAllocation,
    ChannelRole,
    ClaimSource,
    DeterministicChannelScorecard,
    ExternalBudgetMode,
    ExternalBudgetRangeEgp,
    ScenarioType,
    SourcedClaim,
    StrategyBrief,
)

from app.decisions.config import (
    CONSERVATIVE_BUDGET_RATIO,
    GROWTH_BUDGET_RATIO,
    SCENARIO_ONLY_DEFAULT_PERIOD,
)
from app.decisions.normalize import NormalizedInputs


def distribute_exactly(total: int, weights: list[float]) -> list[int]:
    """
    Largest-remainder method: floor shares then distribute leftover units.

    Tie-break on fractional remainder desc, then by input order (higher weight first).
    """
    if not weights:
        return []
    if total == 0:
        return [0 for _ in weights]

    weight_sum = sum(weights)
    if weight_sum <= 0:
        equal = total // len(weights)
        remainder = total - equal * len(weights)
        return [equal + (1 if i < remainder else 0) for i in range(len(weights))]

    raw = [total * w / weight_sum for w in weights]
    floored = [int(r // 1) for r in raw]
    remainders = [(raw[i] - floored[i], -weights[i], i) for i in range(len(weights))]
    leftover = total - sum(floored)
    remainders.sort(reverse=True)
    for k in range(leftover):
        _, _, index = remainders[k % len(remainders)]
        floored[index] += 1
    return floored


def _base_total_egp(
    brief: StrategyBrief,
    normalized: NormalizedInputs,
) -> float:
    budget = brief.external_budget_egp
    if isinstance(budget, ExternalBudgetRangeEgp):
        midpoint = (budget.min_egp + budget.max_egp) / 2
        rounded = round(midpoint / 50) * 50
        return max(budget.min_egp, min(budget.max_egp, rounded))
    if normalized.budget_anchor_egp is not None:
        return normalized.budget_anchor_egp
    return 0.0


def _scenario_period(brief: StrategyBrief) -> str:
    mode = brief.external_budget_mode
    if mode == ExternalBudgetMode.monthly_amount:
        return "monthly"
    if mode == ExternalBudgetMode.three_month_amount:
        return "twelve_week"
    return SCENARIO_ONLY_DEFAULT_PERIOD


def _approved_maximum(brief: StrategyBrief) -> float | None:
    budget = brief.external_budget_egp
    if budget is None:
        return None
    if isinstance(budget, (int, float)):
        return float(budget)
    return budget.max_egp


def _allocations_for_scenario(
    *,
    total_egp: int,
    selected: list[DeterministicChannelScorecard],
) -> list[ChannelAllocation]:
    weights = [card.total_score for card in selected]
    amounts = distribute_exactly(total_egp, weights)
    percentages = distribute_exactly(100, weights)
    return [
        ChannelAllocation(
            channel=card.channel,
            amount_egp=float(amounts[i]),
            percentage=float(percentages[i]),
        )
        for i, card in enumerate(selected)
    ]


def _scenario_notes(scenario_type: ScenarioType, total: int) -> SourcedClaim:
    return SourcedClaim(
        text=f"Deterministic {scenario_type.value} scenario at {total} EGP.",
        source=ClaimSource.deterministic_result,
        citation_ids=[],
    )


def compute_budget_scenarios(
    *,
    brief: StrategyBrief,
    normalized: NormalizedInputs,
    selected_scorecards: list[DeterministicChannelScorecard],
) -> list[BudgetScenario] | None:
    """
    Build budget scenarios for paid modes.

    Returns None when paid_media_allowed is False or mode is organic_only.
    """
    if not brief.paid_media_allowed:
        return None
    if brief.external_budget_mode == ExternalBudgetMode.organic_only:
        return None

    selected = sorted(
        selected_scorecards,
        key=lambda c: (
            0 if c.role == ChannelRole.primary else 1,
            -c.total_score,
            c.channel,
        ),
    )
    if not selected:
        return None

    base_total = _base_total_egp(brief, normalized)
    period = _scenario_period(brief)
    approved_max = _approved_maximum(brief)

    scenario_totals = {
        ScenarioType.conservative: max(1, int(round(base_total * CONSERVATIVE_BUDGET_RATIO))),
        ScenarioType.base: max(1, int(round(base_total))),
        ScenarioType.growth: max(1, int(round(base_total * GROWTH_BUDGET_RATIO))),
    }

    scenarios: list[BudgetScenario] = []
    for scenario_type, total in scenario_totals.items():
        requires_approval = approved_max is not None and total > approved_max
        scenarios.append(
            BudgetScenario(
                scenario_type=scenario_type,
                period=period,  # type: ignore[arg-type]
                total_egp=float(total),
                channel_allocations=_allocations_for_scenario(
                    total_egp=total,
                    selected=selected,
                ),
                requires_owner_budget_approval=requires_approval,
                notes=_scenario_notes(scenario_type, total),
            )
        )
    return scenarios
