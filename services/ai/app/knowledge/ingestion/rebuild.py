"""Rebuild helper: re-embed and re-upsert approved live knowledge versions.

This module is separate from the main pipeline because it does not create new
versions; it only regenerates embeddings for the current approved corpus and
ensures Qdrant matches PostgreSQL.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import Settings
from app.db.client import create_async_engine_from_settings
from app.db.models import (
    MarketingKnowledgeEntry,
    MarketingKnowledgeEntryVersion,
)
from app.embeddings.base import EmbedRequest
from app.embeddings.factory import EmbeddingProviderFactory
from app.knowledge.ingestion.errors import IngestionError, IngestionErrorCode
from app.knowledge.ingestion.qdrant_sync import upsert_chunk_embeddings_to_qdrant
from app.knowledge.ingestion.repository import (
    create_ingestion_run,
    finish_run,
    get_chunks_by_version,
    increment_run_counts,
    record_ingestion_error,
)
from app.qdrant.client import create_qdrant_client
from app.qdrant.collection import ensure_collection, validate_collection_compatibility
from app.qdrant.indexes import create_payload_indexes


logger = logging.getLogger(__name__)


async def get_live_approved_versions(
    session,
) -> list[tuple[MarketingKnowledgeEntry, MarketingKnowledgeEntryVersion]]:
    """Return all entries whose latest version is approved and not retired/expired."""
    result = await session.execute(
        select(MarketingKnowledgeEntry, MarketingKnowledgeEntryVersion)
        .join(
            MarketingKnowledgeEntryVersion,
            MarketingKnowledgeEntry.id == MarketingKnowledgeEntryVersion.entry_id,
        )
        .where(
            MarketingKnowledgeEntry.latest_version == MarketingKnowledgeEntryVersion.version,
            MarketingKnowledgeEntryVersion.review_status == "approved",
        )
        .order_by(MarketingKnowledgeEntry.slug)
    )
    return list(result.all())


@dataclass
class RebuildReport:
    """Outcome of a rebuild operation."""

    status: str
    actor: str
    entries_processed: int = 0
    chunks_processed: int = 0
    errors: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "actor": self.actor,
            "entries_processed": self.entries_processed,
            "chunks_processed": self.chunks_processed,
            "errors": self.errors,
        }


async def rebuild_qdrant_index(
    *,
    cli_token: str,
    actor: str,
    collection_name: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> RebuildReport:
    """Re-embed and re-upsert all approved live versions to Qdrant.

    Args:
        cli_token: Required shared-secret CLI token.
        actor: Who initiated the rebuild.
        collection_name: Optional Qdrant collection override.
        settings: Optional Settings override.
    """
    from app.knowledge.ingestion.pipeline import _verify_cli_token

    settings = settings or Settings()
    _verify_cli_token(settings, cli_token)

    target_collection = collection_name or settings.qdrant_collection_name
    provider = EmbeddingProviderFactory.from_settings(settings)
    embedding_config = provider.config

    report = RebuildReport(status="running", actor=actor)

    engine = create_async_engine_from_settings(settings)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    # Ensure Qdrant collection exists and is compatible.
    qdrant_client = create_qdrant_client(settings)
    try:
        await validate_collection_compatibility(
            qdrant_client,
            collection_name=target_collection,
            expected_size=embedding_config.dimensions,
            expected_provider=embedding_config.provider,
            expected_model=embedding_config.model,
            expected_version=embedding_config.version,
        )
        await ensure_collection(
            qdrant_client,
            collection_name=target_collection,
            vector_size=embedding_config.dimensions,
            embedding_provider=embedding_config.provider,
            embedding_model=embedding_config.model,
            embedding_version=embedding_config.version,
        )
        await create_payload_indexes(qdrant_client, target_collection)
    finally:
        await qdrant_client.close()

    async with session_factory() as session:
        run = await create_ingestion_run(
            session,
            actor=actor,
            commit_sha=None,
            configuration={
                "mode": "rebuild",
                "collection": target_collection,
                "embedding": provider.dump_config(),
            },
        )
        await session.commit()

        live_versions = await get_live_approved_versions(session)

        for entry, version in live_versions:
            chunks = await get_chunks_by_version(session, version.id)
            if not chunks:
                continue

            try:
                async with session.begin_nested():
                    texts = [chunk.text for chunk in chunks]
                    response = await provider.embed(
                        EmbedRequest(texts=texts, purpose="retrieval_document")
                    )
                    vectors_by_chunk_id = {
                        chunks[embedding.index].chunk_id: embedding.vector
                        for embedding in response.embeddings
                    }

                    chunks_with_embeddings = [
                        (chunk, vectors_by_chunk_id[chunk.chunk_id])
                        for chunk in chunks
                        if chunk.chunk_id in vectors_by_chunk_id
                    ]
                    versions_by_chunk_id = {
                        chunk.id: (entry.slug, version) for chunk in chunks
                    }

                    await upsert_chunk_embeddings_to_qdrant(
                        chunks_with_embeddings,
                        versions_by_chunk_id,
                        target_collection,
                        embedding_config,
                    )

                    # Mark chunks indexed.
                    now = datetime.now(timezone.utc).replace(tzinfo=None)
                    for chunk in chunks:
                        chunk.indexed_at = now
                    await session.flush()

                report.entries_processed += 1
                report.chunks_processed += len(chunks_with_embeddings)
            except Exception as exc:
                logger.exception("Rebuild failed for %s", entry.slug)
                # The begin_nested() context manager rolls back the savepoint
                # automatically when the exception propagates.
                error = IngestionError(
                    code=IngestionErrorCode.QDRANT_UPSERT_FAILED,
                    message=str(exc),
                    slug=entry.slug,
                    version=version.version,
                    retryable=True,
                )
                await record_ingestion_error(
                    session,
                    run_id=run.id,
                    slug=entry.slug,
                    version=version.version,
                    code=error.code,
                    message=error.message,
                )
                report.errors.append(
                    {
                        "slug": entry.slug,
                        "version": version.version,
                        "code": error.code,
                        "message": error.message,
                    }
                )

        report.status = "partial_failure" if report.errors else "succeeded"
        await increment_run_counts(
            session,
            run.id,
            entered=report.entries_processed,
            failed=len(report.errors),
        )
        await finish_run(session, run.id, report.status)
        await session.commit()

    await engine.dispose()
    return report
