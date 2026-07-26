"""Structured explanation inputs for the LLM/UI.

Every explanation object contains the deterministic value and the human-readable
factors that produced it, so the generation/UI layer never needs to re-read raw
profile or brief data to explain a score.
"""

from __future__ import annotations

from pydantic import BaseModel

from strategy_contracts import (
    BudgetScenario,
    ChannelRole,
    DeterministicChannelScorecard,
    KpiTarget,
)

from app.decisions.channel_scoring import DimensionResult
from app.decisions.config import (
    CHANNEL_EFFORT_TIER,
    CHANNEL_MIN_VIABLE_SPEND_EGP,
    CHANNEL_REQUIRED_ASSET_KEYWORDS,
    MEASUREMENT_READINESS_BASELINE,
    MEASUREMENT_READINESS_VETO_THRESHOLD,
    SUPPORTING_CHANNEL_MIN_TOTAL_SCORE,
)


class DimensionExplanation(BaseModel):
    """One dimension's score plus the factors that produced it."""

    name: str
    value: float
    factors: list[str]
    config_constants_involved: list[str]


class ChannelScoreExplanation(BaseModel):
    """Explanation for a single channel's deterministic score."""

    channel: str
    role: ChannelRole
    total_score: float
    dimensions: list[DimensionExplanation]
    excluded_reason: str | None
    config_constants_involved: list[str]


def _dimension_config_constants(name: str, channel: str) -> list[str]:
    """Return the config constants relevant to a dimension for a channel."""
    if name == "team_capacity":
        effort = CHANNEL_EFFORT_TIER.get(channel, "medium")
        return [f"channel_effort_tier: {effort}"]
    if name == "budget_fit":
        minimum = CHANNEL_MIN_VIABLE_SPEND_EGP.get(channel, 0)
        return [f"required_minimum_spend_egp: {minimum}"]
    if name == "asset_format_fit":
        required = CHANNEL_REQUIRED_ASSET_KEYWORDS.get(channel, ())
        return [f"required_asset_keywords: {list(required)}"]
    if name == "measurement_readiness":
        baseline = MEASUREMENT_READINESS_BASELINE.get(channel, 0.4)
        return [
            f"measurement_readiness_baseline: {baseline}",
            f"measurement_readiness_veto_threshold: {MEASUREMENT_READINESS_VETO_THRESHOLD}",
        ]
    return []


def build_channel_explanation(
    channel: str,
    dim_results: list[DimensionResult],
    total_score: float,
    excluded_reason: str | None,
    role: ChannelRole,
) -> ChannelScoreExplanation:
    """Build a structured explanation from dimension results."""
    dimension_names = [
        "objective_fit",
        "audience_fit",
        "existing_presence",
        "asset_format_fit",
        "team_capacity",
        "budget_fit",
        "evidence_strength",
        "measurement_readiness",
    ]
    config_constants: list[str] = []
    dimensions: list[DimensionExplanation] = []
    for name, result in zip(dimension_names, dim_results, strict=True):
        constants = _dimension_config_constants(name, channel)
        config_constants.extend(constants)
        dimensions.append(
            DimensionExplanation(
                name=name,
                value=round(result.value, 2),
                factors=result.factors,
                config_constants_involved=constants,
            )
        )
    return ChannelScoreExplanation(
        channel=channel,
        role=role,
        total_score=round(total_score, 2),
        dimensions=dimensions,
        excluded_reason=excluded_reason,
        config_constants_involved=[
            f"supporting_channel_min_total_score: {SUPPORTING_CHANNEL_MIN_TOTAL_SCORE}",
        ]
        + config_constants,
    )


class StrategyDecisionBundle(BaseModel):
    """Complete deterministic output for a strategy scoring run."""

    channel_scorecards: list[DeterministicChannelScorecard]
    selected_channels: list[DeterministicChannelScorecard]
    channel_explanations: list[ChannelScoreExplanation]
    budget_scenarios: list[BudgetScenario] | None
    kpi_targets: list[KpiTarget]
    knowledge_gaps: list[dict]
