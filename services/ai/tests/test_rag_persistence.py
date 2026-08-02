from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import StrategyRetrievalRun
from app.rag.persistence import save_retrieval_run, get_retrieval_run
from app.rag.schemas import RetrievedKnowledgePack, HydratedItem, KnowledgeGap


pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_save_and_get_retrieval_run(db_session: AsyncSession):
    strategy_result = await db_session.execute(
        text(
            """
            SELECT strategy_id, id, business_profile_version_id
            FROM strategy_briefs
            ORDER BY created_at
            LIMIT 1
            """
        )
    )
    strategy_row = strategy_result.first()
    if strategy_row is None:
        pytest.skip("No complete Strategy brief seed exists for the persistence test")

    strategy_id, brief_id, profile_version_id = strategy_row
    run_id = uuid4()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    pack = RetrievedKnowledgePack(
        retrieval_run_id=run_id,
        query_summary="Test query",
        query_context={"business_type": "retail"},
        profile_version_id=profile_version_id,
        brief_id=brief_id,
        items=[
            HydratedItem(
                chunk_id=uuid4(),
                entry_id=uuid4(),
                entry_version=1,
                title="Test Playbook",
                excerpt="This is a test.",
                kind="framework",
                tags={"industries": ["retail"]},
                relevance_score=0.95,
                evidence_tier="reviewed_guidance",
                source_references=["Internal"],
                effective_at=now,
                expires_at=None,
                review_status="approved",
                market_tier="egypt",
                is_fallback=False,
                fallback_label=None,
                category="framework_diagnosis",
            )
        ],
        knowledge_gaps=[
            KnowledgeGap(
                category="budget_method",
                description="Missing budget playbook.",
                severity="non_critical",
            )
        ],
        retrieval_metadata={"embedding_model": "test"},
        retrieved_at=now,
    )

    await save_retrieval_run(db_session, strategy_id, pack)
    await db_session.commit()

    # Fetch it back
    saved_run = await get_retrieval_run(db_session, run_id)
    
    assert saved_run is not None
    assert saved_run.strategy_id == strategy_id
    assert saved_run.brief_id == brief_id
    assert saved_run.profile_version_id == profile_version_id
    assert saved_run.query_summary == "Test query"
    assert saved_run.query_context == {"business_type": "retail"}
    assert saved_run.status == "completed"
    assert saved_run.item_count == 1
    assert saved_run.gap_count == 1

    assert len(saved_run.items) == 1
    assert saved_run.items[0].title == "Test Playbook"
    assert saved_run.items[0].category == "framework_diagnosis"
    assert saved_run.items[0].relevance_score == 0.95

    assert len(saved_run.gaps) == 1
    assert saved_run.gaps[0].category == "budget_method"
    assert saved_run.gaps[0].severity == "non_critical"
