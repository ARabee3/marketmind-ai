"""Channel exclusion and 2+1 selection logic."""

from __future__ import annotations

from strategy_contracts import ChannelRole, DeterministicChannelScorecard, calculate_channel_total

from app.decisions.channel_scoring import DimensionResult
from app.decisions.config import (
    MEASUREMENT_READINESS_VETO_THRESHOLD,
    SUPPORTING_CHANNEL_MIN_TOTAL_SCORE,
    TIE_BREAK_ORDER,
)


EXCLUSION_INSUFFICIENT_CAPACITY = "insufficient_team_capacity"
EXCLUSION_NO_MEASUREMENT = "no_measurement_capability"


def apply_exclusions(
    channel: str,
    scores,
    dim_results: list[DimensionResult],
    total: float,
) -> str | None:
    """Return excluded_reason or None if eligible for selection."""
    dimension_names = (
        "objective_fit",
        "audience_fit",
        "existing_presence",
        "asset_format_fit",
        "team_capacity",
        "budget_fit",
        "evidence_strength",
        "measurement_readiness",
    )
    by_name = dict(zip(dimension_names, dim_results, strict=True))

    if by_name["team_capacity"].value == 0.0:
        return EXCLUSION_INSUFFICIENT_CAPACITY
    if by_name["measurement_readiness"].value < MEASUREMENT_READINESS_VETO_THRESHOLD:
        return EXCLUSION_NO_MEASUREMENT
    return None


def select_channels(
    scored: list[tuple[str, object, list[DimensionResult], float]],
) -> tuple[list[DeterministicChannelScorecard], list[DeterministicChannelScorecard]]:
    """
    Build scorecards with roles assigned.

    Sort eligible channels by (total_score desc, channel slug asc) per {TIE_BREAK_ORDER}.
    Top 2 → primary; 3rd → supporting only if total >= SUPPORTING_CHANNEL_MIN_TOTAL_SCORE.

    Returns (all_channel_scores, selected_channels).
    """
    scorecards: list[DeterministicChannelScorecard] = []
    eligible: list[tuple[str, object, list[DimensionResult], float]] = []

    for channel, scores, dim_results, total in scored:
        excluded = apply_exclusions(channel, scores, dim_results, total)
        scorecards.append(
            DeterministicChannelScorecard(
                channel=channel,
                role=ChannelRole.supporting,
                scores=scores,
                total_score=calculate_channel_total(
                    DeterministicChannelScorecard(
                        channel=channel,
                        role=ChannelRole.supporting,
                        scores=scores,
                        total_score=0,
                    )
                ),
                excluded_reason=excluded,
            )
        )
        if excluded is None:
            eligible.append((channel, scores, dim_results, total))

    eligible.sort(key=lambda row: (-row[3], row[0]))

    selected_channels: set[str] = set()
    for index, (channel, _, _, total) in enumerate(eligible[:3]):
        if index == 2 and total < SUPPORTING_CHANNEL_MIN_TOTAL_SCORE:
            break
        selected_channels.add(channel)

    for card in scorecards:
        if card.channel not in selected_channels:
            continue
        rank = next(i for i, row in enumerate(eligible) if row[0] == card.channel)
        if rank < 2:
            card.role = ChannelRole.primary
        elif rank == 2:
            card.role = ChannelRole.supporting

    selected = [card for card in scorecards if card.channel in selected_channels]
    return scorecards, selected
