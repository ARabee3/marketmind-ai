"""Idempotent ingestion pipeline orchestration.

Coordinates:
1. CLI token authentication
2. Markdown corpus loading and validation
3. Chunking
4. Per-entry PostgreSQL transactions (entry, version, sources, chunks)
5. Batch embedding generation
6. Qdrant upserts with stable point IDs
7. Superseded/removed version retirement
8. Ingestion run reporting
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.db.client import create_async_engine_from_settings
from app.db.models import (
    Base,
    MarketingKnowledgeChunk,
    MarketingKnowledgeEntry,
    MarketingKnowledgeEntryVersion,
)
from app.embeddings.base import EmbedRequest, EmbeddingConfig, EmbeddingProvider
from app.embeddings.factory import EmbeddingProviderFactory
from app.knowledge.ingestion.chunker import MarkdownChunker
from app.knowledge.ingestion.errors import IngestionError, IngestionErrorCode
from app.knowledge.ingestion.loader import load_and_validate_corpus
from app.knowledge.ingestion.qdrant_sync import upsert_chunk_embeddings_to_qdrant
from app.knowledge.ingestion.repository import (
    create_chunks,
    create_entry,
    create_ingestion_run,
    create_source_refs,
    create_version,
    finish_run,
    get_entry_by_slug,
    get_latest_version,
    increment_run_counts,
    record_ingestion_error,
    retire_previous_versions,
    retire_removed_entries,
    update_entry_latest_version,
    mark_chunks_indexed,
)
from app.knowledge.ingestion.schemas import (
    IngestionEntryResult,
    IngestionReport,
    KnowledgeChunk,
    ParsedKnowledgeEntry,
)
from app.qdrant.client import create_qdrant_client
from app.qdrant.collection import ensure_collection, validate_collection_compatibility
from app.qdrant.indexes import create_payload_indexes
from app.qdrant.points import delete_points_by_chunk_ids


logger = logging.getLogger(__name__)


class IngestionAuthenticationError(Exception):
    pass


@dataclass
class _ClassifiedEntries:
    new: list[ParsedKnowledgeEntry]
    changed: list[ParsedKnowledgeEntry]
    unchanged: list[ParsedKnowledgeEntry]
    corpus_slugs: set[str]


@dataclass
class _EntryOutcome:
    entry_result: IngestionEntryResult
    version_id: Optional[UUID] = None
    chunks: list[KnowledgeChunk] = None  # type: ignore[assignment]


def _verify_cli_token(settings: Settings, token: Optional[str]) -> None:
    """Verify the CLI authentication token."""
    expected = settings.knowledge_internal_cli_token
    if not expected:
        raise IngestionAuthenticationError(
            "KNOWLEDGE_INTERNAL_CLI_TOKEN is not configured in services/ai/.env"
        )
    if not token:
        raise IngestionAuthenticationError(
            "CLI authentication token is missing",
        )
    # Constant-time comparison.
    import hmac

    if not hmac.compare_digest(token, expected):
        raise IngestionAuthenticationError(
            "CLI authentication token is invalid",
        )


def _embedding_config_from_settings(settings: Settings) -> EmbeddingConfig:
    return EmbeddingConfig(
        provider=settings.embedding_provider_mode,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
        batch_size=settings.embedding_batch_size,
        version="embedding-v1",
    )


def _pipeline_config(
    settings: Settings,
    source_dir: Optional[str] = None,
    qdrant_collection_name: Optional[str] = None,
) -> dict:
    """Return a serializable configuration snapshot for the ingestion run."""
    return {
        "source_dir": source_dir or settings.knowledge_source_dir,
        "chunk_min_tokens": settings.knowledge_chunk_min_tokens,
        "chunk_max_tokens": settings.knowledge_chunk_max_tokens,
        "chunk_overlap_tokens": settings.knowledge_chunk_overlap_tokens,
        "strict_sources": settings.knowledge_strict_sources,
        "embedding": EmbeddingProviderFactory.from_settings(settings).dump_config(),
        "qdrant_collection": qdrant_collection_name or settings.qdrant_collection_name,
    }


def _create_chunker(settings: Settings) -> MarkdownChunker:
    return MarkdownChunker(
        min_tokens=settings.knowledge_chunk_min_tokens,
        max_tokens=settings.knowledge_chunk_max_tokens,
        overlap_tokens=settings.knowledge_chunk_overlap_tokens,
    )


async def _classify_entries(
    session: AsyncSession,
    entries: list[ParsedKnowledgeEntry],
) -> _ClassifiedEntries:
    """Classify entries as new, changed, or unchanged by comparing body checksums."""
    new: list[ParsedKnowledgeEntry] = []
    changed: list[ParsedKnowledgeEntry] = []
    unchanged: list[ParsedKnowledgeEntry] = []
    corpus_slugs: set[str] = set()

    for entry in entries:
        corpus_slugs.add(entry.slug)
        db_entry = await get_entry_by_slug(session, entry.slug)
        if db_entry is None:
            new.append(entry)
            continue
        latest = await get_latest_version(session, db_entry.id)
        if latest is None:
            new.append(entry)
        elif latest.checksum == entry.body_checksum:
            unchanged.append(entry)
        else:
            changed.append(entry)

    return _ClassifiedEntries(
        new=new,
        changed=changed,
        unchanged=unchanged,
        corpus_slugs=corpus_slugs,
    )


async def _persist_entry(
    session: AsyncSession,
    parsed: ParsedKnowledgeEntry,
    chunks: list[KnowledgeChunk],
    embedding_config: EmbeddingConfig,
    qdrant_collection_name: str,
    actor: str,
) -> _EntryOutcome:
    """Persist one entry's new version, sources, and chunks in a transaction.

    This function is intended to be called inside an active session/transaction.
    """
    db_entry = await get_entry_by_slug(session, parsed.slug)
    if db_entry is None:
        db_entry = await create_entry(session, parsed.slug)
        previous_version = None
        new_version_number = 1
    else:
        latest = await get_latest_version(session, db_entry.id)
        previous_version = latest.version if latest else 0
        new_version_number = previous_version + 1

    version = await create_version(
        session,
        db_entry.id,
        new_version_number,
        parsed,
        parsed.body_checksum,
    )
    await create_source_refs(session, version.id, parsed.source_references)
    await create_chunks(
        session,
        version.id,
        chunks,
        embedding_config,
        qdrant_collection_name,
    )
    await update_entry_latest_version(session, db_entry.id, new_version_number)
    await retire_previous_versions(session, db_entry.id, new_version_number)

    return _EntryOutcome(
        entry_result=IngestionEntryResult(
            slug=parsed.slug,
            previous_version=previous_version,
            new_version=new_version_number,
            status="new" if previous_version is None else "updated",
            chunk_count=len(chunks),
        ),
        version_id=version.id,
        chunks=chunks,
    )


async def _embed_chunks_in_batches(
    provider: EmbeddingProvider,
    chunks: list[KnowledgeChunk],
    batch_size: int,
) -> dict[UUID, list[float]]:
    """Generate embeddings for chunks in batches.

    Returns a mapping from chunk_id to vector.
    """
    vectors: dict[UUID, list[float]] = {}
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        request = EmbedRequest(texts=[c.text for c in batch])
        response = await provider.embed(request)
        for embedding in response.embeddings:
            chunk_id = batch[embedding.index].chunk_id
            vectors[chunk_id] = embedding.vector
    return vectors


async def _ensure_qdrant_collection_and_indexes(settings: Settings, config: EmbeddingConfig) -> None:
    """Ensure the configured Qdrant collection and payload indexes exist.

    Validates that an existing collection's embedding fingerprint matches the
    current configuration so incompatible vectors are not mixed.
    """
    client = create_qdrant_client(settings)
    try:
        await validate_collection_compatibility(
            client,
            collection_name=settings.qdrant_collection_name,
            expected_size=config.dimensions,
            expected_provider=config.provider,
            expected_model=config.model,
            expected_version=config.version,
        )
        await ensure_collection(
            client,
            collection_name=settings.qdrant_collection_name,
            vector_size=config.dimensions,
            embedding_provider=config.provider,
            embedding_model=config.model,
            embedding_version=config.version,
        )
        await create_payload_indexes(client, settings.qdrant_collection_name)
    finally:
        await client.close()


async def _upsert_entry_to_qdrant(
    session_factory: async_sessionmaker,
    version: MarketingKnowledgeEntryVersion,
    db_chunks: list[MarketingKnowledgeChunk],
    vectors_by_chunk_id: dict[UUID, list[float]],
    entry_slug: str,
    embedding_config: EmbeddingConfig,
    qdrant_collection_name: str,
) -> None:
    """Upsert one entry's chunks into Qdrant and mark them indexed."""
    chunks_with_embeddings = [
        (chunk, vectors_by_chunk_id[chunk.chunk_id])
        for chunk in db_chunks
        if chunk.chunk_id in vectors_by_chunk_id
    ]
    if not chunks_with_embeddings:
        return

    versions_by_chunk_id = {chunk.id: (entry_slug, version) for chunk in db_chunks}
    await upsert_chunk_embeddings_to_qdrant(
        chunks_with_embeddings,
        versions_by_chunk_id,
        qdrant_collection_name,
        embedding_config,
    )

    async with session_factory() as session:
        await mark_chunks_indexed(
            session,
            [chunk.id for chunk, _ in chunks_with_embeddings],
        )
        await session.commit()


async def _cleanup_retired_qdrant_points(
    session_factory: async_sessionmaker,
    settings: Settings,
) -> None:
    """Delete Qdrant points for all retired entry versions.

    When version retirement happens in PostgreSQL (via retire_previous_versions
    or retire_removed_entries), the Qdrant points are not updated in the same
    session.  This function queries all retired versions, collects their chunks,
    and deletes them from Qdrant with the stable point IDs.

    If the Qdrant collection does not exist or Qdrant is unreachable, the error
    is logged but not fatal — a subsequent `rebuild` will recover.
    """

    async with session_factory() as session:
        result = await session.execute(
            select(MarketingKnowledgeEntryVersion.id, MarketingKnowledgeEntryVersion.version)
            .where(MarketingKnowledgeEntryVersion.review_status == "retired")
        )
        retired = list(result.all())

    if not retired:
        return

    client = create_qdrant_client(settings)
    try:
        for version_id, version_num in retired:
            async with session_factory() as session:
                result = await session.execute(
                    select(MarketingKnowledgeChunk)
                    .where(MarketingKnowledgeChunk.entry_version_id == version_id)
                )
                chunks = list(result.scalars().all())
                if not chunks:
                    continue
                chunk_ids = [c.chunk_id for c in chunks]
                try:
                    await delete_points_by_chunk_ids(
                        client,
                        settings.qdrant_collection_name,
                        chunk_ids,
                        version_num,
                    )
                except Exception:
                    logger.exception(
                        "Failed to delete Qdrant points for retired version %s", version_id
                    )
    finally:
        await client.close()


async def run_ingestion_pipeline(
    *,
    cli_token: Optional[str] = None,
    actor: str = "unknown",
    commit_sha: Optional[str] = None,
    source_dir: Optional[str] = None,
    strict_sources: Optional[bool] = None,
    repo_root: Optional[str] = None,
    dry_run: bool = False,
    resume: bool = False,
    rebuild: bool = False,
    settings: Optional[Settings] = None,
) -> IngestionReport:
    """Run the full knowledge ingestion pipeline.

    Args:
        cli_token: Required unless the CLI token is disabled (not recommended).
        actor: Who initiated the run.
        commit_sha: Optional git commit SHA.
        source_dir: Override knowledge source directory.
        strict_sources: Override source resolution strictness.
        repo_root: Optional repository root used to resolve a relative source_dir.
        dry_run: If True, validate and report only; no DB writes or embeddings.
        resume: If True, resume from a previous failed run (placeholder).
        rebuild: If True, re-embed and re-upsert approved live versions.
        settings: Optional Settings override.
    """
    from pathlib import Path

    settings = settings or get_settings()
    _verify_cli_token(settings, cli_token)

    source_dir = source_dir or settings.knowledge_source_dir
    strict_sources = (
        strict_sources if strict_sources is not None else settings.knowledge_strict_sources
    )
    repo_root_path = Path(repo_root) if repo_root else None

    # Load and validate corpus.
    entries, validation_errors = await load_and_validate_corpus(
        source_dir=source_dir,
        strict_sources=strict_sources,
        repo_root=repo_root_path,
    )
    if validation_errors:
        report = IngestionReport(
            run_id=UUID("00000000-0000-0000-0000-000000000000"),
            status="failed",
            actor=actor,
            commit_sha=commit_sha,
            configuration=_pipeline_config(settings, source_dir=source_dir),
            errors=[
                {
                    "slug": e.slug,
                    "version": e.version,
                    "code": e.code,
                    "message": e.message,
                }
                for e in validation_errors
            ],
        )
        return report

    if dry_run:
        chunker = _create_chunker(settings)
        return IngestionReport(
            run_id=UUID("00000000-0000-0000-0000-000000000000"),
            status="dry_run",
            actor=actor,
            commit_sha=commit_sha,
            configuration=_pipeline_config(settings, source_dir=source_dir),
            entered_count=len(entries),
            updated_count=0,
            skipped_count=0,
            failed_count=0,
            errors=[],
            entries=[
                IngestionEntryResult(
                    slug=e.slug,
                    previous_version=None,
                    new_version=e.version,
                    status="dry_run",
                    chunk_count=len(chunker.chunk_entry(e)),
                )
                for e in entries
            ],
        )

    # Embedding configuration — created once so the provider and metadata
    # use the same EmbeddingConfig instance.
    embedding_config = _embedding_config_from_settings(settings)
    provider = EmbeddingProviderFactory.from_settings(settings)

    # Verify Qdrant is reachable and the collection is compatible *before*
    # we create the ingestion run, so we can fail fast.
    await _ensure_qdrant_collection_and_indexes(settings, embedding_config)

    # Database setup.
    engine = create_async_engine_from_settings(settings)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        run = await create_ingestion_run(
            session,
            actor=actor,
            commit_sha=commit_sha,
            configuration=_pipeline_config(settings, source_dir=source_dir),
        )
        await session.commit()

        report = IngestionReport(
            run_id=run.id,
            status="running",
            actor=actor,
            commit_sha=commit_sha,
            configuration=run.configuration,
            started_at=run.started_at,
        )

        classified = await _classify_entries(session, entries)
        report.skipped_count = len(classified.unchanged)

        chunker = _create_chunker(settings)
        qdrant_collection_name = settings.qdrant_collection_name

        # Process new and changed entries.
        all_chunks_for_embedding: list[KnowledgeChunk] = []
        version_and_chunks_for_qdrant: list[tuple[UUID, list[KnowledgeChunk]]] = []
        entry_results: list[IngestionEntryResult] = []

        for entry in classified.new + classified.changed:
            chunks = chunker.chunk_entry(entry)
            async with session.begin_nested():
                try:
                    outcome = await _persist_entry(
                        session,
                        entry,
                        chunks,
                        embedding_config,
                        qdrant_collection_name,
                        actor,
                    )
                    entry_results.append(outcome.entry_result)
                    if outcome.entry_result.status == "new":
                        report.entered_count += 1
                    else:
                        report.updated_count += 1
                    all_chunks_for_embedding.extend(chunks)
                    if outcome.version_id:
                        version_and_chunks_for_qdrant.append((outcome.version_id, chunks))
                except Exception as exc:
                    logger.exception("Failed to persist entry %s", entry.slug)
                    # The begin_nested() context manager rolls back the savepoint
                    # automatically when the exception propagates; do not call
                    # session.rollback() while still inside the context manager.
                    error = IngestionError(
                        code=IngestionErrorCode.DB_WRITE_FAILED,
                        message=str(exc),
                        slug=entry.slug,
                        version=entry.version,
                        retryable=True,
                    )
                    await record_ingestion_error(
                        session,
                        run_id=run.id,
                        slug=entry.slug,
                        version=entry.version,
                        code=error.code,
                        message=error.message,
                    )
                    report.failed_count += 1
                    report.errors.append(
                        {
                            "slug": entry.slug,
                            "version": entry.version,
                            "code": error.code,
                            "message": error.message,
                        }
                    )

        # Retire removed entries.
        try:
            async with session.begin_nested():
                retired = await retire_removed_entries(session, classified.corpus_slugs)
                if retired:
                    for entry in retired:
                        latest = await get_latest_version(session, entry.id)
                        entry_results.append(
                            IngestionEntryResult(
                                slug=entry.slug,
                                previous_version=latest.version if latest else None,
                                new_version=None,
                                status="retired",
                                chunk_count=0,
                            )
                        )
        except Exception as exc:
            logger.exception("Failed to retire removed entries")
            # The begin_nested() context manager rolls back the savepoint
            # automatically when the exception propagates.
            error = IngestionError(
                code=IngestionErrorCode.DB_WRITE_FAILED,
                message=f"Failed to retire removed entries: {exc}",
                retryable=True,
            )
            await record_ingestion_error(
                session,
                run_id=run.id,
                slug=None,
                version=None,
                code=error.code,
                message=error.message,
            )
            report.failed_count += 1
            report.errors.append(
                {
                    "slug": None,
                    "version": None,
                    "code": error.code,
                    "message": error.message,
                }
            )

        # Load persisted DB chunks for the versions we just created.
        version_ids = [vid for vid, _ in version_and_chunks_for_qdrant]
        db_chunks_by_version: dict[UUID, list] = {}
        if version_ids:
            result = await session.execute(
                select(MarketingKnowledgeChunk)
                .where(MarketingKnowledgeChunk.entry_version_id.in_(version_ids))
                .order_by(MarketingKnowledgeChunk.entry_version_id, MarketingKnowledgeChunk.chunk_order)
            )
            for chunk in result.scalars().all():
                db_chunks_by_version.setdefault(chunk.entry_version_id, []).append(chunk)

        # Load versions for Qdrant payload assembly.
        version_rows: dict[UUID, MarketingKnowledgeEntryVersion] = {}
        if version_ids:
            result = await session.execute(
                select(MarketingKnowledgeEntryVersion)
                .where(MarketingKnowledgeEntryVersion.id.in_(version_ids))
            )
            version_rows = {v.id: v for v in result.scalars().all()}

        # Load entry slugs for Qdrant payload assembly.
        entry_ids = {v.entry_id for v in version_rows.values()}
        entry_slugs_by_id: dict[UUID, str] = {}
        if entry_ids:
            result = await session.execute(
                select(MarketingKnowledgeEntry).where(MarketingKnowledgeEntry.id.in_(entry_ids))
            )
            entry_slugs_by_id = {e.id: e.slug for e in result.scalars().all()}

        await session.commit()

    # Embed all chunks for new/changed entries.
    vectors_by_chunk_id: dict[UUID, list[float]] = {}
    if all_chunks_for_embedding:
        try:
            vectors_by_chunk_id = await _embed_chunks_in_batches(
                provider,
                all_chunks_for_embedding,
                embedding_config.batch_size,
            )
        except Exception as exc:
            logger.exception("Batch embedding failed")
            error = IngestionError(
                code=IngestionErrorCode.EMBEDDING_PROVIDER_ERROR,
                message=str(exc),
                retryable=True,
            )
            report.errors.append(
                {
                    "slug": None,
                    "version": None,
                    "code": error.code,
                    "message": error.message,
                }
            )
            report.failed_count += 1

    # Upsert each entry's chunks to Qdrant.
    for version_id, _ in version_and_chunks_for_qdrant:
        db_chunks = db_chunks_by_version.get(version_id, [])
        version = version_rows.get(version_id)
        if not version or not db_chunks:
            continue
        entry_slug = entry_slugs_by_id.get(version.entry_id, "unknown")
        try:
            await _upsert_entry_to_qdrant(
                session_factory,
                version,
                db_chunks,
                vectors_by_chunk_id,
                entry_slug,
                embedding_config,
                qdrant_collection_name,
            )
        except Exception as exc:
            logger.exception("Qdrant upsert failed for version %s", version_id)
            error = IngestionError(
                code=IngestionErrorCode.QDRANT_UPSERT_FAILED,
                message=str(exc),
                slug=entry_slug,
                version=version.version,
                retryable=True,
            )
            report.errors.append(
                {
                    "slug": entry_slug,
                    "version": version.version,
                    "code": error.code,
                    "message": error.message,
                }
            )
            report.failed_count += 1

    # Delete Qdrant points for versions retired during this run.
    try:
        await _cleanup_retired_qdrant_points(session_factory, settings)
    except Exception as exc:
        logger.exception("Failed to clean up retired Qdrant points: %s", exc)

    # Determine final run status.
    if report.errors:
        report.status = "partial_failure" if (report.entered_count or report.updated_count) else "failed"
    else:
        report.status = "succeeded"
    report.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # Update ingestion run in DB.
    async with session_factory() as session:
        await increment_run_counts(
            session,
            run.id,
            entered=report.entered_count,
            updated=report.updated_count,
            skipped=report.skipped_count,
            failed=report.failed_count,
        )
        await finish_run(session, run.id, report.status)
        await session.commit()

    await engine.dispose()
    report.entries = entry_results
    return report


async def ensure_database_schema(settings: Optional[Settings] = None) -> None:
    """Create the knowledge tables if they do not exist.

    This is a convenience for local development and tests. In production,
    migrations are owned by apps/api.
    """
    settings = settings or get_settings()
    engine = create_async_engine_from_settings(settings)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
