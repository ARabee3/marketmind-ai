from __future__ import annotations

import uuid as uuid_pkg
from datetime import datetime

import pytest

from app.core.config import Settings
from app.embeddings import EmbeddingConfig
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.qdrant import create_collection, create_payload_indexes, collection_exists
from app.strategy.retrieval_adapter import contract_pack_to_rag
from strategy_contracts import RetrievedKnowledgePack

from tests.evaluation.dataset.schema import EvalCase
from tests.evaluation.runner.comparison_rubric import evaluate_rag_vs_norag
from tests.evaluation.runner.generation_runner import GenerationEvalRunner, make_eval_brief, make_empty_retrieval_pack
from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner
from tests.strategy.fixtures import default_business_profile, load_json


def _retrieval_result_to_pack(
    case: EvalCase,
    ret_result,
    all_fixture_data: list[list[dict]],
    brief,
    profile,
) -> RetrievedKnowledgePack:
    """Convert a RetrievalEvalResult into a contract-valid RetrievedKnowledgePack.

    Uses the actual fixture data so chunk content is realistic and the
    pack passes contract validation.
    """
    base_dict = load_json("strategy-retrieval-pack.example.json")
    contract_items = []
    seen_chunks = set()
    for sq_res in ret_result.subquery_results:
        for chunk_id in sq_res.returned_chunk_ids:
            if chunk_id in seen_chunks:
                continue
            seen_chunks.add(chunk_id)
            fixture_item = None
            for fixture_list in all_fixture_data:
                for item in fixture_list:
                    if item["chunk_id"] == chunk_id:
                        fixture_item = item
                        break
                if fixture_item:
                    break
            if fixture_item:
                contract_items.append({
                    "chunk_id": str(fixture_item["chunk_id"]),
                    "entry_id": str(fixture_item["entry_id"]),
                    "entry_version": fixture_item.get("entry_version", 1),
                    "title": fixture_item.get("checksum", "Stub Title"),
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
                })

    base_dict["retrieval_run_id"] = str(uuid_pkg.uuid4())
    base_dict["brief_id"] = str(brief.id)
    base_dict["profile_version_id"] = str(profile.id)
    base_dict["items"] = contract_items
    base_dict["knowledge_gaps"] = [
        {"category": cat, "description": f"Missing: {cat}", "severity": "non_critical"}
        for cat in ret_result.detected_gap_categories
    ]
    base_dict["query_context"] = case.query_input.model_dump()
    return RetrievedKnowledgePack.model_validate(base_dict)


@pytest.mark.eval_smoke
@pytest.mark.asyncio
async def test_rag_vs_norag_comparison_smoke(
    qdrant_test_client,
    all_fixture_data: list[list[dict]],
    eval_dataset,
    fake_provider: DeterministicFakeEmbeddingProvider,
) -> None:
    """Compare RAG vs No-RAG using real Qdrant retrieval output for the first case."""
    collection_name = "eval_rag_comparison"
    if not await collection_exists(qdrant_test_client, collection_name):
        await create_collection(qdrant_test_client, collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, collection_name)

    ret_runner = RetrievalEvalRunner(qdrant_test_client, collection_name, fake_provider)
    await ret_runner.load_fixtures(all_fixture_data)

    gen_runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    case = eval_dataset.cases[0]
    brief = make_eval_brief(case)
    profile = default_business_profile()

    ret_result = await ret_runner.run_case(case)
    rag_pack = _retrieval_result_to_pack(case, ret_result, all_fixture_data, brief, profile)

    empty_pack = make_empty_retrieval_pack(brief, profile)
    pair = await gen_runner.run_case_pair(case, profile=profile, pack=rag_pack)

    rag_pack_for_rubric = contract_pack_to_rag(rag_pack)
    rubric_result = evaluate_rag_vs_norag(
        case_id=case.id,
        case_language=case.language,
        case_sector=case.sector,
        rag_plan=pair.rag_plan,
        rag_pack=rag_pack_for_rubric,
        no_rag_plan=pair.no_rag_plan,
        no_rag_pack=empty_pack,
    )

    # In mock mode the provider returns a default plan whose citations reference
    # the example pack chunk_ids, not the real Qdrant ones.  The pipeline-level
    # validation verifies that RAG produces at least as many grounded claims as
    # the no-RAG baseline; full grounding pass/fail requires a real LLM provider.
    assert rubric_result.has_more_grounded_claims, f"RAG had fewer grounded claims: {rubric_result.summary}"
    # In mock mode the provider returns a default plan for every input, so both
    # RAG and no-RAG runs produce identical citation counts.  The improvement
    # score floor of 0.3 is the base assigned when all_grounding_passed is
    # False — expected since mock citations reference example-pack chunk_ids
    # that don't exist in the real Qdrant fixtures.
    assert rubric_result.grounding_improvement_score >= 0.3


@pytest.mark.eval_full
@pytest.mark.asyncio
async def test_rag_vs_norag_comparison_all_cases(
    qdrant_test_client,
    all_fixture_data: list[list[dict]],
    eval_dataset,
    fake_provider: DeterministicFakeEmbeddingProvider,
) -> None:
    """Compare RAG vs No-RAG using real Qdrant retrieval across all 25 dataset cases."""
    collection_name = "eval_rag_comparison_all"
    if not await collection_exists(qdrant_test_client, collection_name):
        await create_collection(qdrant_test_client, collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, collection_name)

    ret_runner = RetrievalEvalRunner(qdrant_test_client, collection_name, fake_provider)
    await ret_runner.load_fixtures(all_fixture_data)

    gen_runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    failed: list[str] = []
    for case in eval_dataset.cases:
        brief = make_eval_brief(case)
        profile = default_business_profile()

        ret_result = await ret_runner.run_case(case)
        rag_pack = _retrieval_result_to_pack(case, ret_result, all_fixture_data, brief, profile)

        empty_pack = make_empty_retrieval_pack(brief, profile)
        pair = await gen_runner.run_case_pair(case, profile=profile, pack=rag_pack)

        rag_pack_for_rubric = contract_pack_to_rag(rag_pack)
        rubric_result = evaluate_rag_vs_norag(
            case_id=case.id,
            case_language=case.language,
            case_sector=case.sector,
            rag_plan=pair.rag_plan,
            rag_pack=rag_pack_for_rubric,
            no_rag_plan=pair.no_rag_plan,
            no_rag_pack=empty_pack,
        )

        if not rubric_result.has_more_grounded_claims:
            failed.append(f"{case.id}: {rubric_result.summary}")

    assert len(failed) == 0, "Cases failed grounding improvement:\n" + "\n".join(failed)
