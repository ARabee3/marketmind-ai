"""Default fixture data for the deterministic mock Strategy provider.

The JSON source lives in the shared contract examples so the mock provider
returns a valid StrategyPlan shape. IDs are overwritten at runtime to match
the current request.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from strategy_contracts import StrategyPlan, StrategyPlanV2


EXAMPLE_DIR = Path(__file__).parent.parent.parent.parent.parent / "packages" / "contracts" / "examples"


def load_default_plan_fixture() -> StrategyPlan:
    """Load the canonical strategy plan example used by the mock provider."""
    text = (EXAMPLE_DIR / "strategy-plan.example.json").read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(text)
    return StrategyPlan.model_validate(data)


def load_default_plan_v2_fixture() -> StrategyPlanV2:
    """Load the canonical owner-first strategy-v2 plan example."""
    text = (EXAMPLE_DIR / "strategy-plan-v2.example.json").read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(text)
    return StrategyPlanV2.model_validate(data)
