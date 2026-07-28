from __future__ import annotations

import pytest

from app.core.config import Settings
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.qdrant import create_collection, create_payload_indexes, collection_exists
from app.strategy.retrieval_adapter import contract_pack_to_rag

from tests.evaluation.dataset.schema import EvalCase
from tests.evaluation.runner.comparison_rubric import evaluate_rag_vs_norag
from tests.evaluation.runner.generation_runner import (
    GenerationEvalRunner,
    make_empty_retrieval_pack,
    make_eval_brief,
    retrieval_result_to_pack,
)
from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner
from tests.strategy.fixtures import default_business_profile, default_plan


def test_rag_comparison_rejects_unresolved_rag_citations() -> None:
    profile = default_business_profile()
    case_plan = default_plan()
    no_rag_plan = case_plan.model_copy(update={"citations": []})
    empty_pack = make_empty_retrieval_pack(
        make_eval_brief(
            EvalCase.model_validate(
                {
                    "id": "mismatch-case",
                    "sector": "retail",
                    "language": "en",
                    "description": "Mismatched citation regression case.",
                    "query_input": {
                        "business_type": "retail",
                        "market": "egypt",
                        "locale": "en",
                        "objective": "awareness",
                        "funnel_stage": "awareness",
                        "active_channels": ["facebook"],
                        "asset_capability": ["photos"],
                        "team_capacity": "owner only",
                        "budget_mode": "organic_only",
                    },
                    "expected_retrieval": {
                        "expected_chunk_ids": [],
                        "forbidden_chunk_ids": [],
                        "required_gap_categories": [],
                    },
                    "hard_filter_cases": [],
                    "reviewer": "@reviewer",
                    "reviewed_at": "2026-07-15",
                }
            )
        ),
        profile,
    )

    result = evaluate_rag_vs_norag(
        case_id="mismatch-case",
        rag_plan=case_plan,
        rag_pack=empty_pack,
        no_rag_plan=no_rag_plan,
        no_rag_pack=empty_pack,
    )

    assert result.rag_grounding_passed is False
    assert result.has_more_grounded_claims is False
    assert result.grounding_improvement_score == 0.0


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
    rag_pack = retrieval_result_to_pack(case, ret_result, all_fixture_data, brief, profile)

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

    assert rubric_result.rag_grounding_passed, rubric_result.summary
    assert rubric_result.has_more_grounded_claims, f"RAG had fewer grounded claims: {rubric_result.summary}"
    assert rubric_result.grounding_improvement_score >= 0.6


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
        rag_pack = retrieval_result_to_pack(case, ret_result, all_fixture_data, brief, profile)

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
