"""Tests for budget scenario and allocation arithmetic."""

from __future__ import annotations

import pytest
from hypothesis import given, strategies as st

from strategy_contracts import ExternalBudgetMode

from app.decisions.budget_arithmetic import (
    compute_budget_scenarios,
    distribute_exactly,
)
from app.decisions.normalize import NormalizedInputs

from tests.decisions.fixtures.base import default_brief


def test_distribute_exactly_sums_to_total():
    weights = [3.0, 2.0, 1.0]
    total = 1000
    result = distribute_exactly(total, weights)
    assert sum(result) == total
    assert len(result) == len(weights)
    assert all(r >= 0 for r in result)


def test_distribute_exactly_with_equal_weights():
    weights = [1.0, 1.0, 1.0]
    total = 100
    result = distribute_exactly(total, weights)
    assert sum(result) == total
    assert all(r >= 33 for r in result)


def test_distribute_exactly_zero_weights():
    weights = [0.0, 0.0]
    total = 100
    result = distribute_exactly(total, weights)
    assert sum(result) == total


def test_distribute_exactly_zero_total():
    weights = [3.0, 2.0]
    total = 0
    result = distribute_exactly(total, weights)
    assert result == [0, 0]


def test_distribute_exactly_empty_weights():
    assert distribute_exactly(100, []) == []


@given(
    total=st.integers(min_value=0, max_value=10000),
    weights=st.lists(st.floats(min_value=0.0, max_value=100.0), min_size=1, max_size=10),
)
def test_distribute_exactly_property(total, weights):
    result = distribute_exactly(total, weights)
    assert sum(result) == total
    assert len(result) == len(weights)
    assert all(r >= 0 for r in result)


def test_organic_only_returns_none():
    brief = default_brief(
        budget_mode=ExternalBudgetMode.organic_only,
        budget_egp=None,
    )
    normalized = NormalizedInputs(
        capacity_tier=None,  # type: ignore[arg-type]
        budget_anchor_egp=None,
        budget_is_range=False,
    )
    from app.decisions.channel_scoring import score_all_channels
    from app.decisions.channel_selection import select_channels
    from app.decisions.normalize import CapacityTier
    from tests.decisions.fixtures.base import (
        default_business_profile,
        default_retrieval_pack,
    )

    profile = default_business_profile()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=None,
        budget_is_range=False,
    )
    scored, _ = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    _, selected = select_channels(scored)
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    assert scenarios is None


def test_paid_disallowed_returns_none():
    from app.decisions.channel_scoring import score_all_channels
    from app.decisions.channel_selection import select_channels
    from app.decisions.normalize import CapacityTier
    from tests.decisions.fixtures.base import (
        default_business_profile,
        default_retrieval_pack,
    )

    brief = default_brief(
        paid_media_allowed=False,
        budget_mode=ExternalBudgetMode.scenario_only,
        budget_egp=None,
    )
    profile = default_business_profile()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=None,
        budget_is_range=False,
    )
    scored, _ = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    _, selected = select_channels(scored)
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    assert scenarios is None


def test_scenario_only_without_confirmed_budget_returns_none():
    from app.decisions.channel_scoring import score_all_channels
    from app.decisions.channel_selection import select_channels
    from app.decisions.normalize import CapacityTier
    from tests.decisions.fixtures.base import (
        default_business_profile,
        default_retrieval_pack,
    )

    brief = default_brief(
        paid_media_allowed=True,
        budget_mode=ExternalBudgetMode.scenario_only,
        budget_egp=None,
    )
    profile = default_business_profile()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=None,
        budget_is_range=False,
    )
    scored, _ = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    _, selected = select_channels(scored)
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    assert scenarios is None


def test_paid_mode_produces_three_scenarios():
    from app.decisions.channel_scoring import score_all_channels
    from app.decisions.channel_selection import select_channels
    from app.decisions.normalize import CapacityTier
    from tests.decisions.fixtures.base import (
        default_business_profile,
        default_retrieval_pack,
    )

    brief = default_brief()
    profile = default_business_profile()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    scored, _ = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    _, selected = select_channels(scored)
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    assert scenarios is not None
    assert len(scenarios) == 3
    scenario_types = {s.scenario_type.value for s in scenarios}
    assert scenario_types == {"conservative", "base", "growth"}


def test_scenario_allocations_sum_exactly():
    from app.decisions.channel_scoring import score_all_channels
    from app.decisions.channel_selection import select_channels
    from app.decisions.normalize import CapacityTier
    from tests.decisions.fixtures.base import (
        default_business_profile,
        default_retrieval_pack,
    )

    brief = default_brief()
    profile = default_business_profile()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    scored, _ = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    _, selected = select_channels(scored)
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    assert scenarios is not None
    for scenario in scenarios:
        total_amount = sum(a.amount_egp for a in scenario.channel_allocations)
        total_percentage = sum(a.percentage for a in scenario.channel_allocations)
        assert total_amount == pytest.approx(scenario.total_egp, abs=0.01)
        assert total_percentage == pytest.approx(100.0, abs=0.01)


def test_base_scenario_matches_budget():
    from app.decisions.channel_scoring import score_all_channels
    from app.decisions.channel_selection import select_channels
    from app.decisions.normalize import CapacityTier
    from tests.decisions.fixtures.base import (
        default_business_profile,
        default_retrieval_pack,
    )

    brief = default_brief()
    profile = default_business_profile()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    scored, _ = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    _, selected = select_channels(scored)
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    base = next(s for s in scenarios if s.scenario_type.value == "base")
    assert base.total_egp == 3000.0


def test_budget_range_uses_midpoint():
    from app.decisions.channel_scoring import score_all_channels
    from app.decisions.channel_selection import select_channels
    from app.decisions.normalize import CapacityTier
    from tests.decisions.fixtures.base import (
        default_business_profile,
        default_retrieval_pack,
    )

    brief = default_brief(
        budget_mode=ExternalBudgetMode.monthly_amount,
        budget_egp={"min_egp": 2000, "max_egp": 4000},
    )
    profile = default_business_profile()
    pack = default_retrieval_pack()
    normalized = NormalizedInputs(
        capacity_tier=CapacityTier.low,
        budget_anchor_egp=3000.0,
        budget_is_range=True,
    )
    scored, _ = score_all_channels(
        profile.profile, brief, pack, normalized
    )
    _, selected = select_channels(scored)
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    base = next(s for s in scenarios if s.scenario_type.value == "base")
    assert 2000 <= base.total_egp <= 4000


def test_no_selected_channels_returns_none():
    brief = default_brief()
    normalized = NormalizedInputs(
        capacity_tier=None,  # type: ignore[arg-type]
        budget_anchor_egp=3000.0,
        budget_is_range=False,
    )
    scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=[],
    )
    assert scenarios is None
