"""Tests for deterministic input normalization."""

from __future__ import annotations

import pytest

from strategy_contracts import ExternalBudgetMode

from app.decisions.errors import DecisionRuleInputError
from app.decisions.normalize import (
    CapacityTier,
    NormalizedInputs,
    normalize_budget,
    normalize_inputs,
    normalize_team_capacity,
)

from tests.decisions.fixtures.base import default_brief, default_business_profile


def test_capacity_solo_phrases():
    assert normalize_team_capacity("just me", None) == CapacityTier.none_solo
    assert normalize_team_capacity("I work solo", None) == CapacityTier.none_solo
    assert normalize_team_capacity("No team here", None) == CapacityTier.none_solo


def test_capacity_low_phrases():
    assert normalize_team_capacity("part-time help", None) == CapacityTier.low
    assert normalize_team_capacity("1-2 hours a week", None) == CapacityTier.low


def test_capacity_medium_phrases():
    assert normalize_team_capacity("dedicated marketer", None) == CapacityTier.medium
    assert normalize_team_capacity("in-house staff", None) == CapacityTier.medium


def test_capacity_high_phrases():
    assert normalize_team_capacity("agency handles it", None) == CapacityTier.high
    assert normalize_team_capacity("team of 5 people", None) == CapacityTier.high


def test_capacity_arabic_phrases():
    assert normalize_team_capacity("أنا وحدي", None) == CapacityTier.none_solo
    assert normalize_team_capacity("ساعتين أسبوعياً", None) == CapacityTier.low
    assert normalize_team_capacity("مسوق متفرغ", None) == CapacityTier.medium
    assert normalize_team_capacity("وكالة تسويق", None) == CapacityTier.high


def test_unparseable_defaults_to_low():
    assert normalize_team_capacity("maybe someone", None) == CapacityTier.low


def test_profile_upgrades_one_tier():
    assert (
        normalize_team_capacity("part-time", "dedicated marketer")
        == CapacityTier.medium
    )


def test_profile_does_not_downgrade():
    assert normalize_team_capacity("dedicated marketer", "part-time") == CapacityTier.medium


def test_profile_upgrades_none_solo_to_low():
    assert normalize_team_capacity("just me", "part-time help") == CapacityTier.low


def test_profile_skips_multiple_tier_upgrade():
    """A large profile gap only upgrades by one tier, not directly to high."""
    assert normalize_team_capacity("just me", "agency of 10 people") == CapacityTier.low


def test_normalize_budget_number():
    brief = default_brief(budget_mode=ExternalBudgetMode.monthly_amount, budget_egp=5000)
    anchor, is_range = normalize_budget(brief)
    assert anchor == 5000.0
    assert is_range is False


def test_normalize_budget_range_midpoint():
    brief = default_brief(
        budget_mode=ExternalBudgetMode.monthly_amount,
        budget_egp={"min_egp": 2000, "max_egp": 4000},
    )
    anchor, is_range = normalize_budget(brief)
    assert anchor == 3000.0
    assert is_range is True


def test_normalize_budget_organic_only():
    brief = default_brief(
        budget_mode=ExternalBudgetMode.organic_only,
        budget_egp=None,
    )
    anchor, is_range = normalize_budget(brief)
    assert anchor is None
    assert is_range is False


def test_normalize_budget_missing_raises():
    brief = default_brief().model_copy(
        update={"external_budget_egp": None}
    )
    with pytest.raises(DecisionRuleInputError):
        normalize_budget(brief)


def test_normalize_inputs_returns_capacity_and_budget():
    profile = default_business_profile()
    brief = default_brief()
    normalized = normalize_inputs(brief=brief, profile_payload=profile.profile)
    assert isinstance(normalized, NormalizedInputs)
    assert normalized.capacity_tier == CapacityTier.low
    assert normalized.budget_anchor_egp == 3000.0
    assert normalized.budget_is_range is False
