"""Low capacity fixture builder."""

from __future__ import annotations

from strategy_contracts import ExternalBudgetMode

from tests.decisions.fixtures.base import default_brief, default_business_profile, profile_with_capacity


def low_capacity_profile():
    return profile_with_capacity(default_business_profile(), "just me")


def low_capacity_brief():
    return default_brief(
        team_capacity="just me",
        budget_mode=ExternalBudgetMode.monthly_amount,
        budget_egp=3000,
    )
