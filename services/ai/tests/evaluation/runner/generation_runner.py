from __future__ import annotations

import asyncio
from typing import Any
from pydantic import BaseModel, Field

from strategy_contracts import (
    BusinessProfilePayload,
    RetrievedKnowledgePack,
    StrategyBrief,
    StrategyGenerateRequest,
    StrategyGenerateResponse,
    StrategyPlan,
)

from app.core.config import Settings
from app.decisions.service import compute_strategy_decisions
from app.providers.strategy_provider import create_strategy_provider
from app.strategy.assembler import DecisionBundle, assemble_generation_prompt
from app.strategy.retrieval_adapter import contract_pack_to_rag
from app.strategy.validators import validate_plan_against_request
from tests.evaluation.dataset.schema import EvalCase
from tests.strategy.fixtures import default_business_profile, default_plan, load_json


class GenerationEvalPair(BaseModel):
    case_id: str
    rag_plan: StrategyPlan
    rag_response: StrategyGenerateResponse
    no_rag_plan: StrategyPlan
    no_rag_response: StrategyGenerateResponse


def make_eval_brief(case: EvalCase) -> StrategyBrief:
    """Construct a StrategyBrief from EvalCase query input."""
    base_dict = load_json("strategy-brief.example.json")
    base_dict["primary_objective"] = case.query_input.objective
    base_dict["plan_language"] = case.query_input.locale
    base_dict["external_budget_mode"] = case.query_input.budget_mode
    base_dict["paid_media_allowed"] = case.query_input.budget_mode != "organic_only"
    if case.query_input.budget_mode == "organic_only":
        base_dict["external_budget_egp"] = None
    return StrategyBrief.model_validate(base_dict)


def make_empty_retrieval_pack(brief: StrategyBrief, profile: BusinessProfilePayload) -> RetrievedKnowledgePack:
    """Construct an empty RetrievedKnowledgePack for no-RAG baseline."""
    base_dict = load_json("strategy-retrieval-pack.example.json")
    base_dict["items"] = []
    base_dict["knowledge_gaps"] = [
        {
            "category": "playbook",
            "description": "No-RAG baseline run",
            "severity": "non_critical",
        }
    ]
    base_dict["brief_id"] = str(brief.id)
    base_dict["profile_version_id"] = str(profile.id)
    return RetrievedKnowledgePack.model_validate(base_dict)


class GenerationEvalRunner:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings(ai_provider_mode="mock")
        self.provider = create_strategy_provider(self.settings)

    async def generate_single(
        self,
        profile: BusinessProfilePayload,
        brief: StrategyBrief,
        pack: RetrievedKnowledgePack,
    ) -> StrategyGenerateResponse:
        """Run strategy generation for a specific profile, brief, and knowledge pack."""
        rag_pack = contract_pack_to_rag(pack)
        decisions = compute_strategy_decisions(
            business_profile=profile,
            brief=brief,
            retrieval_pack=rag_pack,
        )

        request = StrategyGenerateRequest(
            contract_version="strategy-v1",
            strategy_id=brief.strategy_id,
            business_profile=profile,
            brief=brief,
            retrieved_knowledge_pack=pack,
            deterministic_channel_scores=default_plan().all_channel_scores,
        )

        bundle = DecisionBundle(
            channel_scores=request.deterministic_channel_scores,
            budget_scenarios=decisions.budget_scenarios,
            kpi_targets=decisions.kpi_targets,
        )

        model_name = self.settings.openai_model or self.settings.gemini_model or "mock"
        prompt = assemble_generation_prompt(
            request=request,
            decision_bundle=bundle,
            provider_name=self.settings.ai_provider_mode,
            model=model_name,
        )

        plan = await self.provider.generate_strategy_plan(prompt)
        validation = validate_plan_against_request(plan=plan, request=request)

        return StrategyGenerateResponse(
            plan=plan,
            validation=validation,
        )

    async def run_case_pair(
        self,
        case: EvalCase,
        profile: BusinessProfilePayload | None = None,
        pack: RetrievedKnowledgePack | None = None,
    ) -> GenerationEvalPair:
        """Run both RAG and No-RAG generations for an evaluation case."""
        profile = profile or default_business_profile()
        brief = make_eval_brief(case)

        # Align IDs
        profile = profile.model_copy(
            update={
                "id": brief.business_profile_version.business_profile_version_id,
                "version": brief.business_profile_version.version,
            }
        )

        # 1. RAG run
        if pack is None:
            pack_dict = load_json("strategy-retrieval-pack.example.json")
            pack = RetrievedKnowledgePack.model_validate(pack_dict)

        rag_pack = pack.model_copy(
            update={
                "profile_version_id": brief.business_profile_version.business_profile_version_id,
                "brief_id": brief.id,
            }
        )
        rag_res = await self.generate_single(profile, brief, rag_pack)

        # 2. No-RAG run
        no_rag_pack = make_empty_retrieval_pack(brief, profile)
        no_rag_res = await self.generate_single(profile, brief, no_rag_pack)

        return GenerationEvalPair(
            case_id=case.id,
            rag_plan=rag_res.plan,
            rag_response=rag_res,
            no_rag_plan=no_rag_res.plan,
            no_rag_response=no_rag_res,
        )
