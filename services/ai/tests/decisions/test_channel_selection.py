"""Tests for channel exclusion and 2+1 selection."""

from __future__ import annotations

from strategy_contracts import ChannelDimensionScores, ChannelRole

from app.decisions.channel_selection import select_channels
from app.decisions.config import SUPPORTING_CHANNEL_MIN_TOTAL_SCORE

DIMENSION_NAMES = [
    "objective_fit",
    "audience_fit",
    "existing_presence",
    "asset_format_fit",
    "team_capacity",
    "budget_fit",
    "evidence_strength",
    "measurement_readiness",
]


def _make_scored(channel_totals: dict[str, float]) -> list:
    from app.decisions.channel_scoring import DimensionResult

    scored = []
    for channel, total in channel_totals.items():
        base = round(total / 8.0, 2)
        dim_results = [DimensionResult(base) for _ in range(8)]
        adjusted_total = sum(r.value for r in dim_results)
        remainder = int(round(total - adjusted_total, 2) * 100)
        step = 0.01 if remainder > 0 else -0.01
        for i in range(abs(remainder)):
            dim_results[i % 8] = DimensionResult(
                max(0.0, min(1.0, round(dim_results[i % 8].value + step, 2)))
            )
        adjusted_total = sum(r.value for r in dim_results)
        scores = ChannelDimensionScores(
            **dict(zip(DIMENSION_NAMES, (r.value for r in dim_results)))
        )
        scored.append((channel, scores, dim_results, adjusted_total))
    return scored


def test_selects_two_primary_and_one_supporting():
    scored = _make_scored({
        "instagram": 7.0,
        "facebook": 6.0,
        "google_maps": 4.0,
        "tiktok": 3.0,
    })
    all_scorecards, selected = select_channels(scored)
    roles = {card.channel: card.role for card in all_scorecards}
    assert roles["instagram"] == ChannelRole.primary
    assert roles["facebook"] == ChannelRole.primary
    assert roles["google_maps"] == ChannelRole.supporting
    assert roles["tiktok"] == ChannelRole.supporting
    assert len(selected) == 3


def test_supporting_channel_must_clear_threshold():
    threshold = SUPPORTING_CHANNEL_MIN_TOTAL_SCORE
    scored = _make_scored({
        "instagram": 7.0,
        "facebook": 6.0,
        "google_maps": threshold - 0.1,
    })
    all_scorecards, selected = select_channels(scored)
    roles = {card.channel: card.role for card in all_scorecards}
    assert roles["instagram"] == ChannelRole.primary
    assert roles["facebook"] == ChannelRole.primary
    assert roles["google_maps"] == ChannelRole.supporting
    assert len(selected) == 2


def test_tie_break_alphabetical():
    scored = _make_scored({
        "facebook": 5.0,
        "google_maps": 5.0,
    })
    all_scorecards, selected = select_channels(scored)
    roles = {card.channel: card.role for card in all_scorecards}
    assert roles["facebook"] == ChannelRole.primary
    assert roles["google_maps"] == ChannelRole.primary
    assert len(selected) == 2


def test_excluded_by_capacity_veto():
    from app.decisions.channel_scoring import DimensionResult

    scored = []
    for channel, team_capacity_value in [
        ("instagram", 1.0),
        ("facebook", 1.0),
        ("tiktok", 0.0),
    ]:
        dim_results = [DimensionResult(1.0) for _ in range(8)]
        dim_results[4] = DimensionResult(team_capacity_value)
        scores = ChannelDimensionScores(
            **dict(zip(DIMENSION_NAMES, (r.value for r in dim_results)))
        )
        total = sum(r.value for r in dim_results)
        scored.append((channel, scores, dim_results, total))
    all_scorecards, selected = select_channels(scored)
    tiktok = next(c for c in all_scorecards if c.channel == "tiktok")
    assert tiktok.excluded_reason == "insufficient_team_capacity"
    assert tiktok.role == ChannelRole.supporting
    assert not any(c.channel == "tiktok" for c in selected)


def test_excluded_by_weak_measurement_readiness_veto():
    from app.decisions.channel_scoring import DimensionResult

    scored = []
    for channel, measurement_value in [
        ("instagram", 1.0),
        ("facebook", 1.0),
        ("tiktok", 0.2),
    ]:
        dim_results = [DimensionResult(1.0) for _ in range(8)]
        dim_results[7] = DimensionResult(measurement_value)
        scores = ChannelDimensionScores(**dict(zip(DIMENSION_NAMES, (r.value for r in dim_results))))
        total = sum(r.value for r in dim_results)
        scored.append((channel, scores, dim_results, total))

    all_scorecards, selected = select_channels(scored)

    tiktok = next(c for c in all_scorecards if c.channel == "tiktok")
    assert tiktok.excluded_reason == "no_measurement_capability"
    assert tiktok.role == ChannelRole.supporting
    assert not any(c.channel == "tiktok" for c in selected)


def test_no_selected_channels_when_all_excluded():
    from app.decisions.channel_scoring import DimensionResult

    scored = []
    for channel in ["instagram", "facebook"]:
        dim_results = [DimensionResult(1.0) for _ in range(8)]
        dim_results[4] = DimensionResult(0.0)
        scores = ChannelDimensionScores(**dict(zip(DIMENSION_NAMES, (r.value for r in dim_results))))
        total = sum(r.value for r in dim_results)
        scored.append((channel, scores, dim_results, total))
    _all_scorecards, selected = select_channels(scored)
    assert selected == []


def test_select_channels_dedupes_google_local_search_ecosystem():
    scored = _make_scored({
        "google_business_profile": 5.0,
        "google_maps": 4.9,
        "facebook": 4.8,
        "delivery_platforms": 4.2,
    })

    all_scorecards, selected = select_channels(scored)

    selected_channels = [card.channel for card in selected]
    google_maps = next(card for card in all_scorecards if card.channel == "google_maps")
    assert set(selected_channels) == {
        "facebook",
        "google_business_profile",
        "delivery_platforms",
    }
    assert google_maps.excluded_reason == "duplicate_local_search_ecosystem"
