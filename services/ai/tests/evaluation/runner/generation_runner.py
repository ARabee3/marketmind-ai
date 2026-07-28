from __future__ import annotations

from uuid import uuid4

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
from tests.evaluation.runner.report import RetrievalEvalResult
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


def eval_case_context(case: EvalCase) -> dict[str, str]:
    return {
        "case_id": case.id,
        "business_type": case.query_input.business_type,
        "objective": str(case.query_input.objective),
        "locale": case.query_input.locale,
    }


def retrieval_result_to_pack(
    case: EvalCase,
    ret_result: RetrievalEvalResult,
    all_fixture_data: list[list[dict]],
    brief: StrategyBrief,
    profile: BusinessProfilePayload,
) -> RetrievedKnowledgePack:
    base_dict = load_json("strategy-retrieval-pack.example.json")
    contract_items = []
    seen_chunks = set()
    for sq_res in ret_result.subquery_results:
        for chunk_id in sq_res.returned_chunk_ids:
            if chunk_id in seen_chunks:
                continue
            seen_chunks.add(chunk_id)
            fixture_item = _find_fixture_item(chunk_id, all_fixture_data)
            if fixture_item is None:
                continue
            contract_items.append(
                {
                    "chunk_id": str(fixture_item["chunk_id"]),
                    "entry_id": str(fixture_item["entry_id"]),
                    "entry_version": fixture_item.get("entry_version", 1),
                    "title": fixture_item.get("checksum", "Fixture Title"),
                    "excerpt": fixture_item["text"][:100],
                    "kind": fixture_item["kind"],
                    "tags": {"industries": fixture_item.get("industries", [])},
                    "relevance_score": 0.95,
                    "source_quality": {
                        "evidence_tier": fixture_item.get("evidence_tier", "reviewed_guidance"),
                        "source_references": ["synthetic-fixture://retrieval-test"],
                        "effective_at": fixture_item["effective_at"],
                        "expires_at": fixture_item.get("expires_at"),
                        "review_status": fixture_item["review_status"],
                    },
                }
            )

    base_dict["retrieval_run_id"] = str(uuid4())
    base_dict["meta"] = {"eval_case_context": eval_case_context(case)}
    base_dict["brief_id"] = str(brief.id)
    base_dict["profile_version_id"] = str(profile.id)
    base_dict["items"] = contract_items
    base_dict["knowledge_gaps"] = [
        {"category": cat, "description": f"Missing: {cat}", "severity": "non_critical"}
        for cat in ret_result.detected_gap_categories
    ]
    base_dict["query_context"] = case.query_input.model_dump()
    return RetrievedKnowledgePack.model_validate(base_dict)


def _find_fixture_item(chunk_id: str, all_fixture_data: list[list[dict]]) -> dict | None:
    for fixture_list in all_fixture_data:
        for item in fixture_list:
            if item["chunk_id"] == chunk_id:
                return item
    return None


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
        if pack.meta and "eval_case_context" in pack.meta:
            prompt.metadata["eval_case_context"] = pack.meta["eval_case_context"]

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
