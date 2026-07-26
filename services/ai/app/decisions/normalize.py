"""
Deterministic input normalization for strategy decision rules.

Precedence and defaults
-----------------------
| Input | Normalized output | Rationale |
| --- | --- | --- |
| brief.team_capacity (canonical) | CapacityTier | Brief is owner-confirmed for this strategy run |
| profile.team_capacity (optional) | May upgrade brief tier by one step | Never downgrade; profile may mention extra help |
| Unparseable team capacity | low | Safer to under-estimate than over-commit channels |
| external_budget_egp number | That value | Direct owner input |
| external_budget_egp range | Midpoint rounded to nearest 50 EGP | Single anchor for proportional scoring |
| null budget under paid mode | DecisionRuleInputError | Upstream brief validation should prevent this |
| organic_only mode | budget anchor ignored (1.0 budget_fit) | No external spend to fit |
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any

from strategy_contracts import (
    ExternalBudgetMode,
    ExternalBudgetRangeEgp,
    StrategyBrief,
)

from app.decisions.config import CAPACITY_TIER_ORDER
from app.decisions.errors import DecisionRuleInputError


class CapacityTier(str, Enum):
    none_solo = "none_solo"
    low = "low"
    medium = "medium"
    high = "high"


class NormalizedInputs:
    """Canonical values derived once per scoring run."""

    __slots__ = ("capacity_tier", "budget_anchor_egp", "budget_is_range")

    def __init__(
        self,
        *,
        capacity_tier: CapacityTier,
        budget_anchor_egp: float | None,
        budget_is_range: bool,
    ) -> None:
        self.capacity_tier = capacity_tier
        self.budget_anchor_egp = budget_anchor_egp
        self.budget_is_range = budget_is_range


_SOLO_PATTERNS = (
    r"\bjust me\b",
    r"\bsolo\b",
    r"\bno team\b",
    r"\bowner only\b",
    r"\balone\b",
)
_LOW_PATTERNS = (
    r"part[- ]?time",
    r"\b1-2\b",
    r"\b2-3 hours\b",
    r"\bfew hours\b",
)
_MEDIUM_PATTERNS = (
    r"\bdedicated\b",
    r"\bin[- ]house\b",
    r"\bmarketer\b",
    r"\bmarketing staff\b",
)
_HIGH_PATTERNS = (
    r"\bagency\b",
    r"\bteam of\b",
    r"\b\d+\+?\s*(people|staff|employees)\b",
)


def _tier_from_text(text: str) -> CapacityTier | None:
    lowered = text.lower()
    if any(re.search(p, lowered) for p in _HIGH_PATTERNS):
        return CapacityTier.high
    if any(re.search(p, lowered) for p in _MEDIUM_PATTERNS):
        return CapacityTier.medium
    if any(re.search(p, lowered) for p in _LOW_PATTERNS):
        return CapacityTier.low
    if any(re.search(p, lowered) for p in _SOLO_PATTERNS):
        return CapacityTier.none_solo
    return None


def _upgrade_one_tier(tier: CapacityTier) -> CapacityTier:
    index = CAPACITY_TIER_ORDER.index(tier.value)
    if index < len(CAPACITY_TIER_ORDER) - 1:
        return CapacityTier(CAPACITY_TIER_ORDER[index + 1])
    return tier


def normalize_team_capacity(
    brief_team_capacity: str,
    profile_team_capacity: str | None,
) -> CapacityTier:
    """Classify team capacity; brief is canonical, profile may upgrade by one tier."""
    brief_tier = _tier_from_text(brief_team_capacity.strip()) if brief_team_capacity.strip() else None
    tier = brief_tier or CapacityTier.low

    if profile_team_capacity and profile_team_capacity.strip():
        profile_tier = _tier_from_text(profile_team_capacity.strip())
        if profile_tier is not None:
            brief_index = CAPACITY_TIER_ORDER.index(tier.value)
            profile_index = CAPACITY_TIER_ORDER.index(profile_tier.value)
            if profile_index > brief_index and profile_index == brief_index + 1:
                tier = profile_tier
            elif profile_index > brief_index + 1:
                tier = _upgrade_one_tier(tier)

    return tier


def _round_to_nearest_50(value: float) -> float:
    return round(value / 50) * 50


def normalize_budget(brief: StrategyBrief) -> tuple[float | None, bool]:
    """
    Return (budget_anchor_egp, is_range).

    Raises DecisionRuleInputError when a paid mode requires budget but none is set.
    """
    mode = brief.external_budget_mode
    budget = brief.external_budget_egp

    if mode == ExternalBudgetMode.organic_only:
        return None, False

    if budget is None:
        if mode in (
            ExternalBudgetMode.monthly_amount,
            ExternalBudgetMode.three_month_amount,
        ):
            raise DecisionRuleInputError(
                "brief.external_budget_egp",
                "Budget is required for monthly_amount and three_month_amount modes.",
            )
        return None, False

    if isinstance(budget, (int, float)):
        if budget <= 0:
            raise DecisionRuleInputError(
                "brief.external_budget_egp",
                "Budget must be a positive number.",
            )
        return float(budget), False

    if isinstance(budget, ExternalBudgetRangeEgp):
        midpoint = (budget.min_egp + budget.max_egp) / 2
        return _round_to_nearest_50(midpoint), True

    raise DecisionRuleInputError(
        "brief.external_budget_egp",
        "Unsupported external_budget_egp shape.",
    )


def profile_team_capacity_from_profile(profile: dict[str, Any]) -> str | None:
    """Extract optional team_capacity from a confirmed business profile payload."""
    goals = (
        profile.get("confirmed_facts", {})
        .get("goals_and_constraints", {})
    )
    value = goals.get("team_capacity")
    return str(value) if value else None


def normalize_inputs(
    *,
    brief: StrategyBrief,
    profile_payload: dict[str, Any],
) -> NormalizedInputs:
    budget_anchor, budget_is_range = normalize_budget(brief)
    capacity = normalize_team_capacity(
        brief.team_capacity,
        profile_team_capacity_from_profile(profile_payload),
    )
    return NormalizedInputs(
        capacity_tier=capacity,
        budget_anchor_egp=budget_anchor,
        budget_is_range=budget_is_range,
    )
