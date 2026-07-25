"""Qdrant upsert helpers for the knowledge ingestion pipeline."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from qdrant_client import AsyncQdrantClient

from app.embeddings.base import EmbeddingConfig
from app.knowledge.ingestion.repository import MarketingKnowledgeChunk
from app.qdrant.client import create_qdrant_client
from app.qdrant.points import upsert_points
from app.qdrant.schemas import QdrantKnowledgePoint
from app.qdrant.collection import QdrantCollectionError


def _build_qdrant_payload(
    chunk: MarketingKnowledgeChunk,
    version,
    entry_slug: str,
) -> QdrantKnowledgePoint:
    """Build a QdrantKnowledgePoint payload from a persisted chunk and version.

    `version` is a MarketingKnowledgeEntryVersion row.
    """
    return QdrantKnowledgePoint(
        chunk_id=chunk.chunk_id,
        entry_id=version.entry_id,
        entry_version=version.version,
        checksum=chunk.checksum,
        text=chunk.text,
        kind=version.kind,
        title_ar=version.title_ar,
        locale=version.locale,
        markets=version.markets,
        industries=version.industries,
        business_models=version.business_models,
        objectives=version.objectives,
        funnel_stages=version.funnel_stages,
        channels=version.channels,
        seasons=version.seasons,
        budget_modes=version.budget_modes,
        evidence_tier=version.evidence_tier,
        review_status=version.review_status,
        effective_at=version.effective_at,
        expires_at=version.expires_at,
    )


async def upsert_chunk_embeddings_to_qdrant(
    chunks_with_embeddings: list[tuple[MarketingKnowledgeChunk, list[float]]],
    versions_by_chunk_id: dict[UUID, tuple],
    collection_name: str,
    embedding_config: EmbeddingConfig,
    client: Optional[AsyncQdrantClient] = None,
) -> None:
    """Upsert embedded chunks into Qdrant with stable point IDs and payloads.

    `versions_by_chunk_id` maps each chunk's primary key to a tuple of
    (entry_slug, version_row). The version_row provides the Qdrant payload.
    """
    if not chunks_with_embeddings:
        return

    points = []
    for chunk, vector in chunks_with_embeddings:
        entry_slug, version = versions_by_chunk_id[chunk.id]
        payload = _build_qdrant_payload(chunk, version, entry_slug)
        points.append((payload, vector))

    qdrant_client = client or create_qdrant_client()
    own_client = client is None
    try:
        await upsert_points(qdrant_client, collection_name, points)
    except QdrantCollectionError as exc:
        raise RuntimeError(f"Qdrant upsert failed: {exc}") from exc
    finally:
        if own_client:
            await qdrant_client.close()


async def qdrant_collection_health() -> dict:
    """Quick Qdrant reachability check."""
    client = create_qdrant_client()
    try:
        collections = await client.get_collections()
        return {"qdrant": "reachable", "collections": len(collections.collections)}
    except Exception as exc:
        return {"qdrant": "unreachable", "error": str(exc)}
    finally:
        await client.close()
