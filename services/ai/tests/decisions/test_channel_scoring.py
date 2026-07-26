"""Tests for the eight channel scoring dimensions."""

from __future__ import annotations

import pytest

from strategy_contracts import ExternalBudgetMode

from app.decisions.channel_scoring import (
    score_all_channels,
    score_asset_format_fit,
    score_audience_fit,
    score_budget_fit,
    score_existing_presence,
    score_measurement_readiness,
    score_objective_fit,
    score_team_capacity,
)
from app.decisions.normalize import CapacityTier, NormalizedInputs

from tests.decisions.fixtures.base import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
    hydrated_item,
    profile_with_customers,
    profile_with_marketing,
    retrieval_pack_with_channel_item,
)


def _make_context():
    from app.decisions.channel_scoring import ScoringContext

    return ScoringContext()


def test_objective_fit_exact_match():
    profile = default_business_profile()
    brief = default_brief()
    pack = retrieval_pack_with_channel_item(
        default_retrieval_pack(),
        channel="instagram",
        objectives=[brief.primary_objective.value],
    )
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_objective_fit(
        "instagram", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 1.0


def test_objective_fit_adjacent_funnel_stage():
    profile = default_business_profile()
    brief = default_brief()
    pack = retrieval_pack_with_channel_item(
        default_retrieval_pack(),
        channel="instagram",
        funnel_stages=["consideration"],
    )
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_objective_fit(
        "instagram", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 0.5


def test_objective_fit_no_item_adds_gap():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    ctx = _make_context()
    result = score_objective_fit(
        "website", profile.profile, brief, pack, normalized, ctx
    )
    assert result.value == 0.0
    assert any("website" in gap.category for gap in ctx.knowledge_gaps)


def test_audience_fit_perfect_overlap():
    profile = default_business_profile()
    profile = profile_with_customers(
        profile,
        primary_segments=["office workers"],
        visit_or_order_occasions=["weekday lunch"],
    )
    brief = default_brief()
    pack = retrieval_pack_with_channel_item(
        default_retrieval_pack(),
        channel="instagram",
        industries=["office workers"],
        business_models=["weekday lunch"],
    )
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_audience_fit(
        "instagram", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 1.0


def test_audience_fit_no_channel_item_neutral():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_audience_fit(
        "website", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 0.5


def test_existing_presence_match():
    profile = default_business_profile()
    profile = profile_with_marketing(
        profile,
        current_activities=["facebook page"],
    )
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_existing_presence(
        "facebook", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 1.0


def test_existing_presence_cold_start_baseline():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_existing_presence(
        "tiktok", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 0.3


def test_asset_format_fit_with_required_assets():
    profile = default_business_profile()
    profile = profile_with_marketing(
        profile,
        available_assets=["phone photos", "short videos", "image reels"],
    )
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_asset_format_fit(
        "instagram", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value > 0.5


def test_asset_format_fit_no_required_assets():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_asset_format_fit(
        "google_business_profile", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 1.0


def test_team_capacity_sufficient():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.high,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_team_capacity(
        "tiktok", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 1.0


def test_team_capacity_insufficient():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.none_solo,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_team_capacity(
        "tiktok", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 0.0


def test_budget_fit_organic_only():
    profile = default_business_profile()
    brief = default_brief(
        budget_mode=ExternalBudgetMode.organic_only,
        budget_egp=None,
    )
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=None,
        budget_is_range=False,
    )
    result = score_budget_fit(
        "facebook", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 1.0


def test_budget_fit_meets_minimum():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_budget_fit(
        "facebook", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 1.0


def test_budget_fit_below_minimum():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=200.0,
        budget_is_range=False,
    )
    result = score_budget_fit(
        "tiktok", profile.profile, brief, pack, normalized, _make_context()
    )
    assert 0.0 < result.value < 1.0


def test_measurement_readiness_baseline():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_measurement_readiness(
        "delivery_platforms", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value == 0.8


def test_measurement_readiness_capacity_boost():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.high,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    result = score_measurement_readiness(
        "instagram", profile.profile, brief, pack, normalized, _make_context()
    )
    assert result.value > 0.5


def test_score_all_channels_produces_eight_dimensions():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    scored, gaps = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    assert scored
    for channel, scores, dim_results, total in scored:
        assert len(dim_results) == 8
        assert 0.0 <= total <= 8.0
        assert all(0.0 <= r.value <= 1.0 for r in dim_results)
    assert isinstance(gaps, list)
