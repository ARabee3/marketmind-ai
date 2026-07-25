import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.models import StrategyRetrievalRun, StrategyRetrievalItem, StrategyRetrievalGap
from app.rag.schemas import RetrievedKnowledgePack, HydratedItem, KnowledgeGap


async def save_retrieval_run(
    session: AsyncSession,
    strategy_id: UUID,
    pack: RetrievedKnowledgePack,
) -> None:
    """Persist a completed retrieval run and its selected items to PostgreSQL."""
    run = StrategyRetrievalRun(
        id=pack.retrieval_run_id,
        strategy_id=strategy_id,
        brief_id=pack.brief_id,
        profile_version_id=pack.profile_version_id,
        query_summary=pack.query_summary,
        query_context=pack.query_context,
        configuration=pack.retrieval_metadata,
        status="completed",
        item_count=len(pack.items),
        gap_count=len(pack.knowledge_gaps),
        latency_ms=pack.retrieval_metadata.get("retrieval_latency_ms", 0),
        started_at=pack.retrieved_at,
        finished_at=pack.retrieved_at,
    )
    
    session.add(run)

    for item in pack.items:
        db_item = StrategyRetrievalItem(
            run_id=run.id,
            chunk_id=item.chunk_id,
            entry_id=item.entry_id,
            entry_version=item.entry_version,
            title=item.title,
            excerpt=item.excerpt,
            kind=item.kind,
            tags=item.tags,
            relevance_score=item.relevance_score,
            evidence_tier=item.evidence_tier,
            source_references=item.source_references,
            effective_at=item.effective_at,
            expires_at=item.expires_at,
            review_status=item.review_status,
            market_tier=item.market_tier,
            is_fallback=item.is_fallback,
            fallback_label=item.fallback_label,
            category=item.category,
        )
        session.add(db_item)

    for gap in pack.knowledge_gaps:
        db_gap = StrategyRetrievalGap(
            run_id=run.id,
            category=gap.category,
            description=gap.description,
            severity=gap.severity,
        )
        session.add(db_gap)

    # Caller controls transaction lifecycle — no commit here


async def get_retrieval_run(
    session: AsyncSession,
    run_id: UUID,
) -> StrategyRetrievalRun | None:
    """Fetch a retrieval run with its items and gaps eager loaded."""
    stmt = (
        select(StrategyRetrievalRun)
        .where(StrategyRetrievalRun.id == run_id)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
