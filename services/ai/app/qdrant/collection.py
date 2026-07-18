from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams

from app.core.config import Settings, get_settings


EMBEDDING_METADATA_KEYS = (
    "embedding_provider",
    "embedding_model",
    "embedding_dimensions",
    "embedding_version",
)


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
    embedding_provider: str | None = None,
    embedding_model: str | None = None,
    embedding_version: str = "embedding-v1",
    settings: Settings | None = None,
) -> None:
    """Create a Qdrant collection with the given vector configuration."""
    config = settings or get_settings()
    metadata = {
        "embedding_provider": embedding_provider or config.embedding_provider_mode,
        "embedding_model": embedding_model or config.embedding_model,
        "embedding_dimensions": vector_size,
        "embedding_version": embedding_version,
    }
    try:
        await client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(
                size=vector_size,
                distance=distance,
                on_disk=on_disk,
            ),
            metadata=metadata,
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
    embedding_provider: str | None = None,
    embedding_model: str | None = None,
    embedding_version: str = "embedding-v1",
    settings: Settings | None = None,
) -> str:
    """Ensure the configured collection exists with embedding metadata."""
    config = settings or get_settings()
    name = collection_name or config.qdrant_collection_name
    size = vector_size or config.embedding_dimensions

    if not await collection_exists(client, name):
        await create_collection(
            client,
            name,
            size,
            embedding_provider=embedding_provider,
            embedding_model=embedding_model,
            embedding_version=embedding_version,
            settings=config,
        )
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
            "metadata": info.config.metadata or {},
        }
    except Exception as exc:
        raise QdrantCollectionError(
            f"Failed to get Qdrant collection info for {collection_name}: {exc}"
        ) from exc


async def validate_collection_compatibility(
    client: AsyncQdrantClient,
    collection_name: str,
    expected_size: int | None = None,
    expected_provider: str | None = None,
    expected_model: str | None = None,
    expected_version: str = "embedding-v1",
    settings: Settings | None = None,
) -> None:
    """Raise if a collection's embedding fingerprint is incompatible."""
    config = settings or get_settings()
    expected_metadata = {
        "embedding_provider": expected_provider or config.embedding_provider_mode,
        "embedding_model": expected_model or config.embedding_model,
        "embedding_dimensions": expected_size or config.embedding_dimensions,
        "embedding_version": expected_version,
    }

    if not await collection_exists(client, collection_name):
        return

    info = await get_collection_info(client, collection_name)
    actual_metadata = dict(info["metadata"])
    actual_metadata["embedding_dimensions"] = info["vector_size"]
    mismatches = [
        f"{key}: stored={actual_metadata.get(key)!r}, "
        f"configured={expected_metadata[key]!r}"
        for key in EMBEDDING_METADATA_KEYS
        if actual_metadata.get(key) != expected_metadata[key]
    ]
    if mismatches:
        raise QdrantCollectionError(
            f"Collection {collection_name} has an incompatible embedding configuration "
            f"({'; '.join(mismatches)}). Create a new collection version and run a "
            "full re-index; do not mix vectors from different embedding configurations."
        )
