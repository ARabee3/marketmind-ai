from uuid import UUID, uuid5

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Filter,
    PointIdsList,
    PointStruct,
    ScoredPoint,
    SearchParams,
)

from app.qdrant.collection import QdrantCollectionError
from app.qdrant.schemas import QdrantKnowledgePoint


NAMESPACE_QDRANT_POINT = UUID("a1ed17b8-5d63-5c20-bdec-7e7e6c2e5e6c")


def generate_point_id(chunk_id: UUID, entry_version: int) -> UUID:
    """Generate a stable Qdrant point ID from chunk_id and entry_version.

    This makes re-ingestion idempotent: the same chunk/version maps to the same
    point ID.
    """
    return uuid5(NAMESPACE_QDRANT_POINT, f"{chunk_id}#{entry_version}")


def build_point_struct(point: QdrantKnowledgePoint) -> PointStruct:
    """Convert a knowledge point into a Qdrant PointStruct."""
    return PointStruct(
        id=generate_point_id(point.chunk_id, point.entry_version),
        vector=[],  # caller must provide the vector separately
        payload=point.to_payload(),
    )


async def upsert_points(
    client: AsyncQdrantClient,
    collection_name: str,
    points: list[tuple[QdrantKnowledgePoint, list[float]]],
) -> None:
    """Upsert knowledge points with their embedding vectors."""
    if not points:
        return

    structs = [
        PointStruct(
            id=generate_point_id(kp.chunk_id, kp.entry_version),
            vector=vector,
            payload=kp.to_payload(),
        )
        for kp, vector in points
    ]
    try:
        await client.upsert(collection_name=collection_name, points=structs)
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to upsert points into {collection_name}: {exc}"
        ) from exc


async def search_points(
    client: AsyncQdrantClient,
    collection_name: str,
    vector: list[float],
    query_filter: Filter | None = None,
    limit: int = 12,
    with_payload: bool = True,
    with_vector: bool = False,
    search_params: SearchParams | None = None,
) -> list[ScoredPoint]:
    """Run a semantic search with optional metadata filters."""
    try:
        return await client.search(
            collection_name=collection_name,
            query_vector=vector,
            query_filter=query_filter,
            limit=limit,
            with_payload=with_payload,
            with_vector=with_vector,
            search_params=search_params,
        )
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to search Qdrant collection {collection_name}: {exc}"
        ) from exc


async def delete_points_by_chunk_ids(
    client: AsyncQdrantClient,
    collection_name: str,
    chunk_ids: list[UUID],
    entry_version: int,
) -> None:
    """Delete points by their stable point IDs derived from chunk/version."""
    if not chunk_ids:
        return
    point_ids = [generate_point_id(chunk_id, entry_version) for chunk_id in chunk_ids]
    try:
        await client.delete(
            collection_name=collection_name,
            points_selector=PointIdsList(points=point_ids),
        )
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to delete points from {collection_name}: {exc}"
        ) from exc


async def count_points(
    client: AsyncQdrantClient,
    collection_name: str,
    query_filter: Filter | None = None,
) -> int:
    """Count points in a collection, optionally filtered."""
    try:
        result = await client.count(
            collection_name=collection_name,
            count_filter=query_filter,
            exact=True,
        )
        return result.count
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to count points in {collection_name}: {exc}"
        ) from exc
