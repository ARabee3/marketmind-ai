"""Koshary Corner organic-only fixture."""

from __future__ import annotations

from strategy_contracts import ExternalBudgetMode

from tests.decisions.fixtures.base import default_brief


def koshary_corner_organic_brief():
    return default_brief(
        paid_media_allowed=False,
        budget_mode=ExternalBudgetMode.organic_only,
        budget_egp=None,
    )
