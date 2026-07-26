"""Integration tests for the full deterministic decision pipeline."""

from __future__ import annotations

import pytest

from strategy_contracts import ChannelRole, ExternalBudgetMode

from app.decisions.service import compute_strategy_decisions

from tests.decisions.fixtures.base import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
    profile_with_capacity,
)


def test_full_pipeline_runs():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    bundle = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    assert bundle.channel_scorecards
    assert bundle.selected_channels
    assert bundle.channel_explanations
    assert len(bundle.channel_explanations) == len(bundle.channel_scorecards)
    primary_count = sum(
        1 for c in bundle.selected_channels if c.role == ChannelRole.primary
    )
    supporting_count = sum(
        1 for c in bundle.selected_channels if c.role == ChannelRole.supporting
    )
    assert primary_count <= 2
    assert supporting_count <= 1
    assert bundle.budget_scenarios is not None
    assert len(bundle.budget_scenarios) == 3


def test_organic_pipeline_has_no_budget_scenarios():
    profile = default_business_profile()
    brief = default_brief(
        budget_mode=ExternalBudgetMode.organic_only,
        budget_egp=None,
    )
    pack = default_retrieval_pack()
    bundle = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    assert bundle.budget_scenarios is None


def test_low_capacity_excludes_tiktok():
    profile = default_business_profile()
    profile = profile_with_capacity(profile, "just me")
    brief = default_brief(team_capacity="just me")
    pack = default_retrieval_pack()
    bundle = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    tiktok = next((c for c in bundle.channel_scorecards if c.channel == "tiktok"), None)
    assert tiktok is not None
    assert tiktok.excluded_reason == "insufficient_team_capacity"
    assert tiktok.role == ChannelRole.supporting


def test_high_capacity_includes_tiktok():
    profile = default_business_profile()
    profile = profile_with_capacity(profile, "team of 5 marketing people")
    brief = default_brief(team_capacity="team of 5 marketing people")
    pack = default_retrieval_pack()
    bundle = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    tiktok = next((c for c in bundle.channel_scorecards if c.channel == "tiktok"), None)
    assert tiktok is not None
    # High capacity may still exclude tiktok via other dimensions, but not capacity
    assert tiktok.excluded_reason != "insufficient_team_capacity" if tiktok.excluded_reason else True


def test_determinism():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    bundle_a = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    bundle_b = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    assert bundle_a.model_dump(mode="json") == bundle_b.model_dump(mode="json")


def test_explanations_contain_factors_and_config():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    bundle = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    for explanation in bundle.channel_explanations:
        assert explanation.dimensions
        for dim in explanation.dimensions:
            assert dim.factors
            assert dim.config_constants_involved is not None
        assert explanation.config_constants_involved


def test_selected_channels_no_more_than_two_primary_one_supporting():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    bundle = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    selected = bundle.selected_channels
    primary = [c for c in selected if c.role == ChannelRole.primary]
    supporting = [c for c in selected if c.role == ChannelRole.supporting]
    assert len(primary) <= 2
    assert len(supporting) <= 1
    assert len(primary) + len(supporting) == len(selected)


def test_kpi_targets_are_present():
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    bundle = compute_strategy_decisions(
        business_profile=profile,
        brief=brief,
        retrieval_pack=pack,
    )
    assert bundle.kpi_targets
    assert all(t.target_mode.value for t in bundle.kpi_targets)
