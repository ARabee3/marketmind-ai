"""Fictional Content request fixtures shared by Content tests."""

import json
from pathlib import Path

from content_contracts import AiContentGenerateRequest, ContentWeekContext
from strategy_contracts import BusinessProfilePayload, StrategyPlan


EXAMPLES_DIR = Path(__file__).parents[4] / "packages" / "contracts" / "examples"


def load_example(name: str) -> dict:
    with (EXAMPLES_DIR / name).open(encoding="utf-8") as file:
        return json.load(file)


def make_valid_request() -> AiContentGenerateRequest:
    strategy = StrategyPlan.model_validate(load_example("strategy-plan.example.json"))
    context = ContentWeekContext.model_validate(
        load_example("content-week-context-owner-promotion.example.json")
    )
    profile = BusinessProfilePayload(
        id=strategy.profile_version.business_profile_version_id,
        business_id="11111111-1111-4111-8111-111111111111",
        version=strategy.profile_version.version,
        profile={"business_name": "Koshary Corner"},
        confirmed_by_user_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        confirmed_at=strategy.profile_version.confirmed_at,
        created_at=strategy.profile_version.confirmed_at,
    )
    return AiContentGenerateRequest(
        contract_version="content-v1",
        content_pack_id="77777777-7777-4777-8777-777777777777",
        business_id=profile.business_id,
        strategy_id=strategy.strategy_id,
        strategy_version=strategy.version,
        strategy_decision_id="55555555-5555-4555-8555-555555555555",
        strategy_plan=strategy,
        business_profile=profile,
        week_context=context,
        selected_channels=["instagram"],
        allowed_formats=["static_image_post"],
        language_mode=strategy.plan_language.value,
    )
