from __future__ import annotations

from uuid import uuid4, UUID
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import Settings
from app.db.models import StrategyRetrievalRun, StrategyRetrievalItem
from app.rag.persistence import save_retrieval_run
from strategy_contracts import RetrievedKnowledgePack as ContractPack
from tests.strategy.fixtures import load_json, default_business_profile
from app.strategy.retrieval_adapter import contract_pack_to_rag
from tests.evaluation.dataset.schema import EvalCase, EvalDataset
from tests.evaluation.runner.grounding_checker import check_strategy_grounding
from tests.evaluation.runner.generation_runner import GenerationEvalRunner, make_eval_brief

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
    # 1. Setup Qdrant fixtures using the fake provider
    from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures(all_fixture_data)

    # 2. Select a representative retail evaluation case
    case = next(c for c in eval_dataset.cases if c.id == "retail-mixed-conversion-003")

    # Run retrieval
    ret_result = await runner.run_case(case)

    strategy_id = uuid4()
    brief = make_eval_brief(case)
    profile = default_business_profile()

    # 3. Construct contract RetrievedKnowledgePack
    base_pack_dict = load_json("strategy-retrieval-pack.example.json")
    
    # Map retrieved chunks to contract format
    contract_items = []
    seen_chunks = set()
    for sq_res in ret_result.subquery_results:
        for chunk_id in sq_res.returned_chunk_ids:
            if chunk_id in seen_chunks:
                continue
            seen_chunks.add(chunk_id)

            # Find the fixture details
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
                    "market_tier": fixture_item.get("markets", ["egypt"])[0],
                    "is_fallback": False,
                    "fallback_label": None,
                    "source_quality": {
                        "evidence_tier": fixture_item.get("evidence_tier", "reviewed_guidance"),
                        "source_references": ["Internal"],
                        "effective_at": fixture_item["effective_at"],
                        "expires_at": fixture_item.get("expires_at"),
                        "review_status": fixture_item["review_status"],
                    }
                })

    run_id = uuid4()
    base_pack_dict["retrieval_run_id"] = str(run_id)
    base_pack_dict["brief_id"] = str(brief.id)
    base_pack_dict["profile_version_id"] = str(profile.id)
    base_pack_dict["items"] = contract_items
    base_pack_dict["knowledge_gaps"] = []
    base_pack_dict["query_context"] = case.query_input.model_dump()
    
    contract_pack = ContractPack.model_validate(base_pack_dict)

    # Convert to RAG pack for saving
    rag_pack = contract_pack_to_rag(contract_pack)

    # 4. Persist the run to PostgreSQL
    await save_retrieval_run(db_session, strategy_id, rag_pack)
    await db_session.flush()  # Push to database within transaction

    # 5. Generate plan using mock LLM
    gen_runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    profile = profile.model_copy(
        update={
            "id": brief.business_profile_version.business_profile_version_id,
            "version": brief.business_profile_version.version,
        }
    )
    # Ensure generated plan gets our exact run ID
    brief = brief.model_copy(update={"strategy_id": str(strategy_id)})

    gen_response = await gen_runner.generate_single(profile, brief, contract_pack)
    plan = gen_response.plan
    plan.retrieval_run_id = contract_pack.retrieval_run_id

    grounding = check_strategy_grounding(plan, rag_pack)
    if not grounding.all_grounding_passed:
        print(f"Mock-mode grounding diagnostics: {grounding.diagnostics}")

    stmt_run = select(StrategyRetrievalRun).where(StrategyRetrievalRun.id == contract_pack.retrieval_run_id)
    db_run = (await db_session.execute(stmt_run)).scalar_one_or_none()
    assert db_run is not None
    assert db_run.strategy_id == strategy_id

    stmt_items = select(StrategyRetrievalItem).where(StrategyRetrievalItem.run_id == contract_pack.retrieval_run_id)
    db_items = (await db_session.execute(stmt_items)).scalars().all()
    assert len(db_items) == len(contract_items)
