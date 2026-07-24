"""Database operations for the knowledge ingestion pipeline.

All functions operate inside an async SQLAlchemy session provided by the caller.
They follow the physical table/column names defined by apps/api/prisma/schema.prisma
and documented in apps/api/prisma/MARKETING_KNOWLEDGE_SCHEMA.md.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    MarketingKnowledgeChunk,
    MarketingKnowledgeEntry,
    MarketingKnowledgeEntryVersion,
    MarketingKnowledgeIngestionError,
    MarketingKnowledgeIngestionRun,
    MarketingKnowledgeSourceRef,
)
from app.embeddings.base import EmbeddingConfig
from app.knowledge.ingestion.schemas import KnowledgeChunk, ParsedKnowledgeEntry


async def get_entry_by_slug(
    session: AsyncSession,
    slug: str,
) -> Optional[MarketingKnowledgeEntry]:
    result = await session.execute(
        select(MarketingKnowledgeEntry).where(MarketingKnowledgeEntry.slug == slug)
    )
    return result.scalar_one_or_none()


async def get_latest_version(
    session: AsyncSession,
    entry_id: UUID,
) -> Optional[MarketingKnowledgeEntryVersion]:
    result = await session.execute(
        select(MarketingKnowledgeEntryVersion)
        .where(MarketingKnowledgeEntryVersion.entry_id == entry_id)
        .order_by(MarketingKnowledgeEntryVersion.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_entry(session: AsyncSession, slug: str) -> MarketingKnowledgeEntry:
    entry = MarketingKnowledgeEntry(slug=slug, latest_version=0)
    session.add(entry)
    await session.flush()
    return entry


async def create_version(
    session: AsyncSession,
    entry_id: UUID,
    version: int,
    parsed: ParsedKnowledgeEntry,
    body_checksum: str,
) -> MarketingKnowledgeEntryVersion:
    """Create a new immutable MarketingKnowledgeEntryVersion."""
    entry_version = MarketingKnowledgeEntryVersion(
        entry_id=entry_id,
        version=version,
        kind=parsed.kind,
        title=parsed.title,
        summary=parsed.summary,
        body=parsed.body,
        locale=parsed.locale,
        markets=parsed.markets,
        industries=parsed.industries,
        business_models=parsed.business_models,
        objectives=parsed.objectives,
        funnel_stages=parsed.funnel_stages,
        channels=parsed.channels,
        seasons=parsed.seasons,
        budget_modes=parsed.budget_modes,
        evidence_tier=parsed.evidence_tier,
        review_status=parsed.review_status,
        effective_at=parsed.effective_at,
        expires_at=parsed.expires_at,
        author=parsed.author,
        reviewer=parsed.reviewer,
        reviewed_at=parsed.reviewed_at,
        checksum=body_checksum,
    )
    session.add(entry_version)
    await session.flush()
    return entry_version


async def create_source_refs(
    session: AsyncSession,
    entry_version_id: UUID,
    references: list[str],
) -> list[MarketingKnowledgeSourceRef]:
    refs = [
        MarketingKnowledgeSourceRef(
            entry_version_id=entry_version_id,
            reference=ref,
        )
        for ref in references
    ]
    session.add_all(refs)
    await session.flush()
    return refs


async def create_chunks(
    session: AsyncSession,
    entry_version_id: UUID,
    entry_version: int,
    chunks: list[KnowledgeChunk],
    embedding_config: EmbeddingConfig,
    qdrant_collection_name: str,
) -> list[MarketingKnowledgeChunk]:
    """Create MarketingKnowledgeChunk rows with pre-computed stable Qdrant point IDs."""
    from app.qdrant.points import generate_point_id

    db_chunks = []
    for chunk in chunks:
        point_id = generate_point_id(chunk.chunk_id, entry_version)
        db_chunks.append(
            MarketingKnowledgeChunk(
                chunk_id=chunk.chunk_id,
                entry_version_id=entry_version_id,
                chunk_order=chunk.chunk_order,
                text=chunk.text,
                token_count=chunk.token_count,
                checksum=chunk.checksum,
                embedding_provider=embedding_config.provider,
                embedding_model=embedding_config.model,
                embedding_dimensions=embedding_config.dimensions,
                embedding_version=embedding_config.version,
                qdrant_point_id=point_id,
                qdrant_collection_name=qdrant_collection_name,
            )
        )
    session.add_all(db_chunks)
    await session.flush()
    return db_chunks


async def update_entry_latest_version(
    session: AsyncSession,
    entry_id: UUID,
    version: int,
) -> None:
    await session.execute(
        update(MarketingKnowledgeEntry)
        .where(MarketingKnowledgeEntry.id == entry_id)
        .values(latest_version=version)
    )


async def retire_previous_versions(
    session: AsyncSession,
    entry_id: UUID,
    new_version: int,
) -> None:
    """Mark all earlier versions of an entry as retired.

    Content fields remain immutable; only review_status changes.
    """
    await session.execute(
        update(MarketingKnowledgeEntryVersion)
        .where(
            MarketingKnowledgeEntryVersion.entry_id == entry_id,
            MarketingKnowledgeEntryVersion.version < new_version,
            MarketingKnowledgeEntryVersion.review_status != "retired",
        )
        .values(review_status="retired")
    )


async def retire_removed_entries(
    session: AsyncSession,
    corpus_slugs: set[str],
) -> list[MarketingKnowledgeEntry]:
    """Mark the latest version of any entry not in the corpus as retired."""
    result = await session.execute(
        select(MarketingKnowledgeEntry).where(
            MarketingKnowledgeEntry.slug.notin_(corpus_slugs)
        )
    )
    removed_entries = result.scalars().all()
    retired: list[MarketingKnowledgeEntry] = []
    for entry in removed_entries:
        latest = await get_latest_version(session, entry.id)
        if latest and latest.review_status != "retired":
            latest.review_status = "retired"
            retired.append(entry)
    await session.flush()
    return retired


async def create_ingestion_run(
    session: AsyncSession,
    actor: str,
    commit_sha: Optional[str],
    configuration: dict,
) -> MarketingKnowledgeIngestionRun:
    run = MarketingKnowledgeIngestionRun(
        actor=actor,
        commit_sha=commit_sha,
        configuration=configuration,
        status="running",
    )
    session.add(run)
    await session.flush()
    return run


async def increment_run_counts(
    session: AsyncSession,
    run_id: UUID,
    *,
    entered: int = 0,
    updated: int = 0,
    skipped: int = 0,
    failed: int = 0,
) -> None:
    run = await session.get(MarketingKnowledgeIngestionRun, run_id)
    if run is None:
        return
    run.entered_count += entered
    run.updated_count += updated
    run.skipped_count += skipped
    run.failed_count += failed


async def finish_run(
    session: AsyncSession,
    run_id: UUID,
    status: str,
) -> None:
    run = await session.get(MarketingKnowledgeIngestionRun, run_id)
    if run is None:
        return
    run.status = status
    run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)


async def record_ingestion_error(
    session: AsyncSession,
    run_id: UUID,
    slug: Optional[str],
    version: Optional[int],
    code: str,
    message: str,
) -> MarketingKnowledgeIngestionError:
    error = MarketingKnowledgeIngestionError(
        run_id=run_id,
        slug=slug,
        version=version,
        error_code=code,
        error_message=message,
    )
    session.add(error)
    await session.flush()
    return error


async def get_chunks_by_version(
    session: AsyncSession,
    entry_version_id: UUID,
) -> list[MarketingKnowledgeChunk]:
    result = await session.execute(
        select(MarketingKnowledgeChunk)
        .where(MarketingKnowledgeChunk.entry_version_id == entry_version_id)
        .order_by(MarketingKnowledgeChunk.chunk_order)
    )
    return list(result.scalars().all())


async def get_unindexed_chunks(
    session: AsyncSession,
    entry_version_id: UUID,
) -> list[MarketingKnowledgeChunk]:
    result = await session.execute(
        select(MarketingKnowledgeChunk)
        .where(
            MarketingKnowledgeChunk.entry_version_id == entry_version_id,
            MarketingKnowledgeChunk.indexed_at.is_(None),
        )
        .order_by(MarketingKnowledgeChunk.chunk_order)
    )
    return list(result.scalars().all())


async def mark_chunks_indexed(
    session: AsyncSession,
    chunk_ids: list[UUID],
) -> None:
    if not chunk_ids:
        return
    await session.execute(
        update(MarketingKnowledgeChunk)
        .where(MarketingKnowledgeChunk.id.in_(chunk_ids))
        .values(indexed_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )


async def get_latest_versions_for_upsert(
    session: AsyncSession,
    entry_version_ids: list[UUID],
) -> list[MarketingKnowledgeEntryVersion]:
    """Hydrate entry versions with their entry slugs for Qdrant payload assembly."""
    result = await session.execute(
        select(MarketingKnowledgeEntryVersion)
        .where(MarketingKnowledgeEntryVersion.id.in_(entry_version_ids))
        .order_by(MarketingKnowledgeEntryVersion.entry_id, MarketingKnowledgeEntryVersion.version)
    )
    return list(result.scalars().all())
