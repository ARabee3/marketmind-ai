"""Deterministic marketing decision rules and validators."""

from app.decisions.service import (
    StrategyDecisionBundle,
    compute_strategy_decisions,
)

__all__ = [
    "compute_strategy_decisions",
    "StrategyDecisionBundle",
]
