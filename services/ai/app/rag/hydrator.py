from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import MarketingKnowledgeChunk, MarketingKnowledgeEntryVersion
from app.rag.schemas import RegionalCandidate, HydratedItem, KnowledgeGap, RetrievalQueryContext, RetrievalSubquery


async def hydrate_candidates(
    session: AsyncSession,
    candidates: list[RegionalCandidate],
    subqueries: list[RetrievalSubquery],
    now: datetime,
) -> tuple[list[HydratedItem], list[KnowledgeGap]]:
    """Hydrate candidates with canonical PostgreSQL data and generate gaps for missing categories.

    Validates that the selected chunks are still eligible (approved, effective, unexpired)
    according to the canonical DB, dropping them if Qdrant is stale.
    """
    if not candidates:
        gaps = [
            KnowledgeGap(
                category=sq.category,
                description=f"No approved marketing knowledge found for {sq.category}.",
                severity="blocking" if sq.category == "framework_diagnosis" else "non_critical",
            )
            for sq in subqueries
        ]
        return [], gaps

    # Extract chunk IDs
    chunk_ids = [c.candidate.chunk_id for c in candidates]

    # Fetch canonical chunks and eager load the entry version and its source refs
    stmt = (
        select(MarketingKnowledgeChunk)
        .options(
            selectinload(MarketingKnowledgeChunk.entry_version).selectinload(
                MarketingKnowledgeEntryVersion.source_refs
            )
        )
        .where(MarketingKnowledgeChunk.chunk_id.in_(chunk_ids))
    )
    result = await session.execute(stmt)
    db_chunks = {c.chunk_id: c for c in result.scalars().all()}

    hydrated_items = []
    covered_categories = set()

    # We iterate over candidates in order to preserve the sorted priority from Phase 3
    for rc in candidates:
        db_chunk = db_chunks.get(rc.candidate.chunk_id)
        if not db_chunk:
            continue  # Qdrant out of sync; chunk no longer exists

        version = db_chunk.entry_version

        # Hard canonical eligibility check
        if version.review_status != "approved":
            continue
        if version.effective_at > now:
            continue
        if version.expires_at and version.expires_at <= now:
            continue

        # Extract tags
        tags = {
            "markets": version.markets,
            "industries": version.industries,
            "business_models": version.business_models,
            "objectives": version.objectives,
            "funnel_stages": version.funnel_stages,
            "channels": version.channels,
            "seasons": version.seasons,
            "budget_modes": version.budget_modes,
        }

        # Format source references
        source_refs = [
            f"{ref.reference}" + (f" ({ref.note})" if ref.note else "")
            for ref in version.source_refs
        ]

        item = HydratedItem(
            chunk_id=db_chunk.chunk_id,
            entry_id=version.entry_id,
            entry_version=version.version,
            title=version.title,
            excerpt=db_chunk.text,
            kind=version.kind,
            tags={k: v for k, v in tags.items() if v},  # Only include non-empty tags
            relevance_score=rc.candidate.score,
            evidence_tier=version.evidence_tier,
            source_references=source_refs,
            effective_at=version.effective_at,
            expires_at=version.expires_at,
            review_status=version.review_status,
            market_tier=rc.market_tier,
            is_fallback=rc.is_fallback,
            fallback_label=rc.fallback_label,
            category=rc.candidate.subquery_category,
        )
        hydrated_items.append(item)
        covered_categories.add(rc.candidate.subquery_category)

    # Generate KnowledgeGaps for subqueries that resulted in 0 items
    gaps = []
    for sq in subqueries:
        if sq.category not in covered_categories:
            gaps.append(
                KnowledgeGap(
                    category=sq.category,
                    description=f"No eligible marketing knowledge retrieved for {sq.category}.",
                    severity="blocking" if sq.category == "framework_diagnosis" else "non_critical",
                )
            )

    return hydrated_items, gaps
