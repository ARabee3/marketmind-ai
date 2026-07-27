from __future__ import annotations

import pytest
from strategy_contracts import RetrievedKnowledgePack

from app.core.config import Settings
from tests.evaluation.dataset.schema import EvalCase
from tests.evaluation.runner.comparison_rubric import evaluate_rag_vs_norag
from tests.evaluation.runner.generation_runner import GenerationEvalRunner, make_eval_brief, make_empty_retrieval_pack
from tests.strategy.fixtures import default_business_profile, load_json


def _build_case_pack(case: EvalCase) -> RetrievedKnowledgePack:
    """Build a RetrievedKnowledgePack populated with the case expected chunk IDs.

    In the mock test pipeline there is no live Qdrant, so we synthesise pack
    items from the case's expected_chunk_ids.  This makes the RAG comparison
    case-specific: the RAG pack contains only the knowledge a real retrieval
    would surface for this case, while the no-RAG pack is always empty.
    """
    brief = make_eval_brief(case)
    profile = default_business_profile()
    base = load_json("strategy-retrieval-pack.example.json")
    # Seed items using the case's expected chunk IDs so each case's RAG pack
    # is unique — even if the item content is stubbed.
    items = []
    for chunk_id in case.expected_retrieval.expected_chunk_ids:
        stub_item = {
            "chunk_id": chunk_id,
            "entry_id": chunk_id.replace("a0000000", "b0000000"),
            "kind": "framework",
            "title": f"Knowledge item {chunk_id}",
            "text": f"Stub knowledge for case {case.id}",
            "locale": case.query_input.locale,
            "markets": [case.query_input.market],
            "evidence_tier": "reviewed_guidance",
            "source_quality": "reviewed_guidance",
        }
        items.append(stub_item)
    base["items"] = items
    base["brief_id"] = str(brief.id)
    base["profile_version_id"] = str(profile.id)
    return RetrievedKnowledgePack.model_validate(base)


@pytest.mark.eval_smoke
@pytest.mark.asyncio
async def test_rag_vs_norag_comparison_smoke(eval_dataset) -> None:
    """Compare RAG vs No-RAG run for the first case with a case-specific pack."""
    runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    case = eval_dataset.cases[0]
    brief = make_eval_brief(case)
    profile = default_business_profile()

    case_pack = _build_case_pack(case)
    pair = await runner.run_case_pair(case, profile=profile, pack=case_pack)

    empty_pack = make_empty_retrieval_pack(brief, profile)
    rubric_result = evaluate_rag_vs_norag(
        case_id=case.id,
        case_language=case.language,
        case_sector=case.sector,
        rag_plan=pair.rag_plan,
        rag_pack=case_pack,
        no_rag_plan=pair.no_rag_plan,
        no_rag_pack=empty_pack,
    )

    assert rubric_result.rag_grounding_passed, f"RAG grounding failed: {rubric_result.summary}"
    assert rubric_result.grounding_improvement_score >= 0.5


@pytest.mark.eval_full
@pytest.mark.asyncio
async def test_rag_vs_norag_comparison_all_cases(eval_dataset) -> None:
    """Compare RAG vs No-RAG runs across all 25 dataset cases with per-case packs."""
    runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))

    failed: list[str] = []
    for case in eval_dataset.cases:
        brief = make_eval_brief(case)
        profile = default_business_profile()
        case_pack = _build_case_pack(case)
        empty_pack = make_empty_retrieval_pack(brief, profile)

        pair = await runner.run_case_pair(case, profile=profile, pack=case_pack)
        rubric_result = evaluate_rag_vs_norag(
            case_id=case.id,
            case_language=case.language,
            case_sector=case.sector,
            rag_plan=pair.rag_plan,
            rag_pack=case_pack,
            no_rag_plan=pair.no_rag_plan,
            no_rag_pack=empty_pack,
        )

        if not rubric_result.has_more_grounded_claims:
            failed.append(f"{case.id}: {rubric_result.summary}")

    assert len(failed) == 0, "Cases failed grounding improvement:\n" + "\n".join(failed)

