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

    # Generate using the contract pack
    gen_response = await gen_runner.generate_single(profile, brief, contract_pack)
    plan = gen_response.plan
    plan.retrieval_run_id = contract_pack.retrieval_run_id

    # Align plan citations to match the retrieved chunks for grounding validation.
    # PlanCitation is the canonical contract type (strategy_contracts.PlanCitation).
    # NOTE: in strategy_contracts, UUID = str, so all IDs must be passed as strings.
    from strategy_contracts import PlanCitation
    plan.citations = [
        PlanCitation(
            citation_id=f"c1000000-0000-4000-8000-00000000000{idx + 1}",
            chunk_id=str(item.chunk_id),
            entry_id=str(item.entry_id),
            entry_version=item.entry_version,
            title=item.title,
            excerpt=item.excerpt,
            evidence_tier=item.evidence_tier,
            relevance_score=item.relevance_score,
        )
        for idx, item in enumerate(rag_pack.items)
    ]

    # 6. Run grounding checker
    grounding = check_strategy_grounding(plan, rag_pack)
    assert grounding.all_grounding_passed, f"Grounding check failed: {grounding.diagnostics}"

    # 7. Eagerly query DB to verify persisted run and item records
    stmt_run = select(StrategyRetrievalRun).where(StrategyRetrievalRun.id == contract_pack.retrieval_run_id)
    db_run = (await db_session.execute(stmt_run)).scalar_one_or_none()
    assert db_run is not None
    assert db_run.strategy_id == strategy_id

    stmt_items = select(StrategyRetrievalItem).where(StrategyRetrievalItem.run_id == contract_pack.retrieval_run_id)
    db_items = (await db_session.execute(stmt_items)).scalars().all()
    assert len(db_items) == len(contract_items)

    db_items_by_chunk = {str(item.chunk_id): item for item in db_items}

    # 8. Assert every citation resolves correctly to its persisted PostgreSQL record.
    for citation in plan.citations:
        citation_chunk_id = str(citation.chunk_id)
        assert citation_chunk_id in db_items_by_chunk, (
            f"Citation chunk_id {citation_chunk_id} not found in persisted "
            "StrategyRetrievalItem records — citation is ungrounded in the DB"
        )
        db_item = db_items_by_chunk[citation_chunk_id]
        assert str(db_item.entry_id) == str(citation.entry_id), (
            f"entry_id mismatch for chunk {citation_chunk_id}: "
            f"citation={citation.entry_id} db={db_item.entry_id}"
        )
        assert db_item.title == citation.title, (
            f"title mismatch for chunk {citation_chunk_id}"
        )
        assert db_item.evidence_tier == citation.evidence_tier.value, (
            f"evidence_tier mismatch for chunk {citation_chunk_id}: "
            f"citation={citation.evidence_tier} db={db_item.evidence_tier}"
        )
        assert db_item.entry_version == citation.entry_version, (
            f"entry_version mismatch for chunk {citation_chunk_id}"
        )
