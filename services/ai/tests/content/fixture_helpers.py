"""Fictional Content request fixtures shared by Content tests."""

import copy
import json
from pathlib import Path

from content_contracts import AiContentGenerateRequest, ContentWeekContext
from content_v2_contracts import (
    AiContentV2GenerateRequest,
    AiContentV2PlanRequest,
    ContentCtaLibraryEntryV2,
    ContentEditorialProfileV2,
    ContentMediaLibraryEntryV2,
    ContentV2FrozenInput,
)
from strategy_contracts import (
    BusinessProfilePayload,
    StrategyPlan,
    StrategyPlanV2,
)

BUSINESS_ID = "11111111-1111-4111-8111-111111111111"
DECISION_ID = "55555555-5555-4555-8555-555555555555"


EXAMPLES_DIR = Path(__file__).parents[4] / "packages" / "contracts" / "examples"


def load_example(name: str) -> dict:
    with (EXAMPLES_DIR / name).open(encoding="utf-8") as file:
        return json.load(file)


def _replace_google_maps(plan: dict, channel: str) -> None:
    """Drop google_maps; ensure ``channel`` is selected with deterministic scores.

    ``selected_channels`` must reuse the exact scorecard found in
    ``all_channel_scores`` (canonical deterministic scores). If the channel is
    already scored there, promote that canonical scorecard; otherwise reuse the
    removed google_maps scorecard under the new channel in both lists.
    """
    all_scores = plan["all_channel_scores"]
    canonical = next((s for s in all_scores if s["channel"] == channel), None)
    google_maps = next(
        (s for s in plan["selected_channels"] if s["channel"] == "google_maps"),
        None,
    )
    plan["selected_channels"] = [
        s for s in plan["selected_channels"] if s["channel"] != "google_maps"
    ]
    all_scores[:] = [s for s in all_scores if s["channel"] != "google_maps"]
    if channel not in {s["channel"] for s in plan["selected_channels"]}:
        if canonical is not None:
            plan["selected_channels"].append(copy.deepcopy(canonical))
        elif google_maps is not None:
            renamed = {**google_maps, "channel": channel}
            plan["selected_channels"].append(renamed)
            all_scores.append({**renamed})


def make_request_with_channel(channel: str, allowed_formats: list[str]) -> AiContentGenerateRequest:
    """Build a valid request whose approved Strategy plan selects ``channel``.

    The canonical example plan selects instagram (primary) and google_maps.
    Swap google_maps out for ``channel`` so it is approved by the Strategy
    without changing the rest of the fixture.
    """
    plan = copy.deepcopy(load_example("strategy-plan.example.json"))
    _replace_google_maps(plan, channel)
    strategy = StrategyPlan.model_validate(plan)
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
        selected_channels=[channel],
        allowed_formats=allowed_formats,
        language_mode=strategy.plan_language.value,
    )


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


def make_valid_plan_request() -> AiContentV2PlanRequest:
    """Build a valid content-v2 planner request from the approved v2 fixture."""
    plan = StrategyPlanV2.model_validate(
        load_example("strategy-plan-v2.example.json")
    )
    handoff = plan.content_handoff
    assert handoff.available is True
    profile = ContentEditorialProfileV2.model_validate(
        load_example("content-v2-editorial-profile.example.json")
    )
    cta_entries = [
        ContentCtaLibraryEntryV2.model_validate(entry)
        for entry in load_example("content-v2-cta-library.example.json")["entries"]
    ]
    media_entries = [
        ContentMediaLibraryEntryV2.model_validate(entry)
        for entry in load_example("content-v2-media-library.example.json")["entries"]
    ]
    return AiContentV2PlanRequest(
        contract_version="content-v2",
        week_plan_id="be000000-0000-4000-8000-00000000be01",
        business_id="11111111-1111-4111-8111-111111111111",
        strategy_id=plan.strategy_id,
        strategy_version=plan.version,
        strategy_decision_id="55555555-5555-4555-8555-555555555555",
        strategy_plan=plan,
        week_number=1,
        editorial_profile=profile,
        cta_library=cta_entries,
        media_library=media_entries,
        allowed_channels=list(handoff.channels),
        allowed_formats=list(handoff.weeks[0].formats),
        language_mode=plan.plan_language,
        idempotency_key="plan-key-1",
    )


def _business_payload_v2(plan: StrategyPlanV2) -> BusinessProfilePayload:
    return BusinessProfilePayload(
        id=plan.profile_version.business_profile_version_id,
        business_id=BUSINESS_ID,
        version=plan.profile_version.version,
        profile={"business_name": "Koshary Corner"},
        confirmed_by_user_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        confirmed_at=plan.profile_version.confirmed_at,
        created_at=plan.profile_version.confirmed_at,
    )


def make_valid_generate_v2_request() -> AiContentV2GenerateRequest:
    """Build a valid content-v2 generation request from frozen fixtures."""
    plan = StrategyPlanV2.model_validate(
        load_example("strategy-plan-v2.example.json")
    )
    frozen = ContentV2FrozenInput.model_validate(
        load_example("content-v2-frozen-input.example.json")
    )
    profile = _business_payload_v2(plan)
    return AiContentV2GenerateRequest(
        contract_version="content-v2",
        content_pack_id="77777777-7777-4777-8777-777777777777",
        business_id=profile.business_id,
        strategy_id=plan.strategy_id,
        strategy_version=plan.version,
        strategy_decision_id=DECISION_ID,
        strategy_plan=plan,
        business_profile=profile.model_dump(mode="json"),
        frozen_input=frozen,
        language_mode=plan.plan_language,
        idempotency_key="generate-v2-key-1",
    )
