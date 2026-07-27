from __future__ import annotations

import pytest
from app.core.config import Settings
from tests.evaluation.runner.generation_runner import GenerationEvalRunner
from tests.evaluation.runner.grounding_checker import check_strategy_grounding
from tests.strategy.fixtures import default_plan, default_retrieval_pack, default_business_profile, default_brief


@pytest.mark.eval_smoke
@pytest.mark.asyncio
async def test_generation_grounding_smoke(eval_dataset) -> None:
    """Run generation runner on a smoke case and verify grounding passes."""
    runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    case = eval_dataset.cases[0]

    response = await runner.generate_single(
        profile=default_business_profile(),
        brief=default_brief(),
        pack=default_retrieval_pack(),
    )

    assert response.plan is not None
    assert response.validation.valid, f"Validation failed: {response.validation.errors}"

    grounding_result = check_strategy_grounding(response.plan, default_retrieval_pack())
    assert grounding_result.all_grounding_passed, f"Grounding failed: {grounding_result.diagnostics}"


@pytest.mark.eval_full
@pytest.mark.asyncio
async def test_generation_grounding_all_cases(eval_dataset) -> None:
    """Run generation runner across all 25 dataset cases in mock mode."""
    runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))

    failed_cases = []
    for case in eval_dataset.cases:
        pair = await runner.run_case_pair(case)
        grounding = check_strategy_grounding(pair.rag_plan, default_retrieval_pack())
        if not grounding.all_grounding_passed:
            failed_cases.append(f"Case '{case.id}': {grounding.diagnostics}")

    assert len(failed_cases) == 0, f"Grounding failed for cases:\n" + "\n".join(failed_cases)
