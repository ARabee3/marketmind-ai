from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams

from app.core.config import Settings, get_settings


class QdrantCollectionError(Exception):
    """Raised when Qdrant collection operations fail."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


async def collection_exists(
    client: AsyncQdrantClient,
    collection_name: str,
) -> bool:
    return await client.collection_exists(collection_name)


async def create_collection(
    client: AsyncQdrantClient,
    collection_name: str,
    vector_size: int,
    distance: Distance = Distance.COSINE,
    on_disk: bool = False,
) -> None:
    """Create a Qdrant collection with the given vector configuration."""
    try:
        await client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(
                size=vector_size,
                distance=distance,
                on_disk=on_disk,
            ),
        )
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to create Qdrant collection {collection_name}: {exc}"
        ) from exc


async def delete_collection(
    client: AsyncQdrantClient,
    collection_name: str,
) -> None:
    try:
        await client.delete_collection(collection_name=collection_name)
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to delete Qdrant collection {collection_name}: {exc}"
        ) from exc


async def ensure_collection(
    client: AsyncQdrantClient,
    collection_name: str | None = None,
    vector_size: int | None = None,
    settings: Settings | None = None,
) -> str:
    """Ensure the configured collection exists with the right vector size."""
    config = settings or get_settings()
    name = collection_name or config.qdrant_collection_name
    size = vector_size or config.embedding_dimensions

    if not await collection_exists(client, name):
        await create_collection(client, name, size)
    return name


async def get_collection_info(
    client: AsyncQdrantClient,
    collection_name: str,
) -> dict:
    """Return collection info as a dictionary."""
    try:
        info = await client.get_collection(collection_name=collection_name)
        return {
            "status": info.status,
            "indexed_vectors_count": info.indexed_vectors_count,
            "points_count": info.points_count,
            "segments_count": info.segments_count,
            "vector_size": info.config.params.vectors.size,
            "distance": info.config.params.vectors.distance,
        }
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to get Qdrant collection info for {collection_name}: {exc}"
        ) from exc


async def validate_collection_compatibility(
    client: AsyncQdrantClient,
    collection_name: str,
    expected_size: int | None = None,
    settings: Settings | None = None,
) -> None:
    """Raise if an existing collection has an incompatible vector size."""
    config = settings or get_settings()
    expected = expected_size or config.embedding_dimensions

    if not await collection_exists(client, collection_name):
        return

    info = await get_collection_info(client, collection_name)
    actual = info["vector_size"]
    if actual != expected:
        raise QdrantCollectionError(
            f"Collection {collection_name} has vector size {actual}, "
            f"but configured dimensions are {expected}. "
            "Delete the collection or change the embedding configuration to match."
        )
