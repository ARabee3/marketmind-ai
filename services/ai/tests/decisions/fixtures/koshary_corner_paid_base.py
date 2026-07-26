"""Koshary Corner paid base fixture."""

from __future__ import annotations

from strategy_contracts import ExternalBudgetMode

from tests.decisions.fixtures.base import default_brief


def koshary_corner_paid_base_brief():
    return default_brief(
        paid_media_allowed=True,
        budget_mode=ExternalBudgetMode.monthly_amount,
        budget_egp=3000,
    )
