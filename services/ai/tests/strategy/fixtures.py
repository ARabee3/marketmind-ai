"""Reusable fixtures for Strategy generation/revision tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from strategy_contracts import (
    BusinessProfilePayload,
    RetrievedKnowledgePack,
    StrategyBrief,
    StrategyPlan,
    StrategyReviseRequest,
)


EXAMPLES_DIR = Path(__file__).parent.parent.parent.parent.parent / "packages" / "contracts" / "examples"


def load_json(filename: str) -> dict[str, Any]:
    return json.loads((EXAMPLES_DIR / filename).read_text(encoding="utf-8"))


def default_business_profile() -> BusinessProfilePayload:
    journey = load_json("cafe-full-journey.example.json")
    return BusinessProfilePayload.model_validate(journey["confirmed_business_profile"])


def default_brief() -> StrategyBrief:
    return StrategyBrief.model_validate(load_json("strategy-brief.example.json"))


def english_brief() -> StrategyBrief:
    return StrategyBrief.model_validate(load_json("strategy-brief-english.example.json"))


def mixed_brief() -> StrategyBrief:
    return StrategyBrief.model_validate(load_json("strategy-brief-mixed.example.json"))


def default_retrieval_pack() -> RetrievedKnowledgePack:
    return RetrievedKnowledgePack.model_validate(load_json("strategy-retrieval-pack.example.json"))


def default_plan() -> StrategyPlan:
    return StrategyPlan.model_validate(load_json("strategy-plan.example.json"))


def make_generate_request(
    profile: BusinessProfilePayload | None = None,
    brief: StrategyBrief | None = None,
    pack: RetrievedKnowledgePack | None = None,
) -> Any:
    """Build a minimal StrategyGenerateRequest from fixtures.

    Aligns the profile and retrieval pack with the chosen brief so tests can
    focus on generation behaviour without inventing matching fixture data.
    """
    from strategy_contracts import StrategyGenerateRequest

    brief = brief or default_brief()
    profile = profile or default_business_profile()
    pack = pack or default_retrieval_pack()

    # Align IDs so the fixture is internally consistent for the chosen brief.
    profile = profile.model_copy(
        update={
            "id": brief.business_profile_version.business_profile_version_id,
            "version": brief.business_profile_version.version,
        }
    )
    pack = pack.model_copy(
        update={
            "profile_version_id": brief.business_profile_version.business_profile_version_id,
            "brief_id": brief.id,
        }
    )

    return StrategyGenerateRequest(
        contract_version="strategy-v1",
        strategy_id=brief.strategy_id,
        business_profile=profile,
        brief=brief,
        retrieved_knowledge_pack=pack,
        deterministic_channel_scores=default_plan().all_channel_scores,
    )


def make_revise_request(
    profile: BusinessProfilePayload | None = None,
    brief: StrategyBrief | None = None,
    pack: RetrievedKnowledgePack | None = None,
    previous_plan: StrategyPlan | None = None,
    revision_notes: str = "Reduce the Instagram budget and add more Google Maps focus.",
) -> StrategyReviseRequest:
    from strategy_contracts import StrategyReviseRequest

    brief = brief or default_brief()
    profile = profile or default_business_profile()
    pack = pack or default_retrieval_pack()

    profile = profile.model_copy(
        update={
            "id": brief.business_profile_version.business_profile_version_id,
            "version": brief.business_profile_version.version,
        }
    )
    pack = pack.model_copy(
        update={
            "profile_version_id": brief.business_profile_version.business_profile_version_id,
            "brief_id": brief.id,
        }
    )

    return StrategyReviseRequest(
        contract_version="strategy-v1",
        strategy_id=brief.strategy_id,
        business_profile=profile,
        brief=brief,
        retrieved_knowledge_pack=pack,
        deterministic_channel_scores=default_plan().all_channel_scores,
        previous_plan=previous_plan or default_plan(),
        revision_notes=revision_notes,
    )


def make_decision_bundle():
    """Build a DecisionBundle from the default plan fixture."""
    from strategy_contracts import BudgetScenario, KpiTarget
    from app.strategy.assembler import DecisionBundle

    plan = default_plan()
    return DecisionBundle(
        channel_scores=plan.all_channel_scores,
        budget_scenarios=plan.budget_scenarios,
        kpi_targets=plan.kpi_targets,
    )
