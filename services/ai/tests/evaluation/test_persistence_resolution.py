from __future__ import annotations

from uuid import uuid4
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.config import Settings
from app.db.models import StrategyRetrievalRun, StrategyRetrievalItem
from app.rag.persistence import save_retrieval_run
from tests.strategy.fixtures import default_business_profile
from app.strategy.retrieval_adapter import contract_pack_to_rag
from tests.evaluation.dataset.schema import EvalDataset
from tests.evaluation.runner.grounding_checker import check_strategy_grounding
from tests.evaluation.runner.generation_runner import (
    GenerationEvalRunner,
    make_eval_brief,
    retrieval_result_to_pack,
)

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_end_to_end_citation_persistence_resolution(
    db_session: AsyncSession,
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    eval_dataset: EvalDataset,
    all_fixture_data: list[list[dict]],
) -> None:
    """Validate that plan citations correctly resolve to a persisted PostgreSQL run."""
    from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures(all_fixture_data)

    case = next(c for c in eval_dataset.cases if c.id == "retail-mixed-conversion-003")

    ret_result = await runner.run_case(case)

    try:
        strategy_result = await db_session.execute(
            text("SELECT id FROM strategies ORDER BY created_at LIMIT 1")
        )
    except Exception as exc:
        pytest.skip(f"Strategy integration table is unavailable: {exc}")
    strategy_row = strategy_result.first()
    if strategy_row is None:
        pytest.skip("No Strategy seed exists for persistence resolution test")
    strategy_id = strategy_row[0]
    brief = make_eval_brief(case)
    profile = default_business_profile()

    run_id = uuid4()
    contract_pack = retrieval_result_to_pack(case, ret_result, all_fixture_data, brief, profile)
    contract_pack = contract_pack.model_copy(update={"retrieval_run_id": str(run_id)})

    rag_pack = contract_pack_to_rag(contract_pack)

    await save_retrieval_run(db_session, strategy_id, rag_pack)
    await db_session.flush()

    gen_runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    profile = profile.model_copy(
        update={
            "id": brief.business_profile_version.business_profile_version_id,
            "version": brief.business_profile_version.version,
        }
    )
    brief = brief.model_copy(update={"strategy_id": str(strategy_id)})

    gen_response = await gen_runner.generate_single(profile, brief, contract_pack)
    plan = gen_response.plan
    plan.retrieval_run_id = contract_pack.retrieval_run_id

    grounding = check_strategy_grounding(plan, rag_pack)
    assert grounding.all_grounding_passed, f"Mock-mode grounding diagnostics: {grounding.diagnostics}"

    stmt_run = select(StrategyRetrievalRun).where(StrategyRetrievalRun.id == contract_pack.retrieval_run_id)
    db_run = (await db_session.execute(stmt_run)).scalar_one_or_none()
    assert db_run is not None
    assert db_run.strategy_id == strategy_id

    stmt_items = select(StrategyRetrievalItem).where(StrategyRetrievalItem.run_id == contract_pack.retrieval_run_id)
    db_items = (await db_session.execute(stmt_items)).scalars().all()
    assert len(db_items) == len(contract_pack.items)
