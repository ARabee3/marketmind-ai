"""Qdrant client lifecycle helpers."""

from contextlib import asynccontextmanager

from qdrant_client import AsyncQdrantClient

from app.core.config import Settings, get_settings


class QdrantConnectionError(Exception):
    """Raised when Qdrant is unreachable."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def create_qdrant_client(settings: Settings | None = None) -> AsyncQdrantClient:
    """Create an async Qdrant client from application settings."""
    config = settings or get_settings()
    kwargs: dict = {
        "host": config.qdrant_host,
        "port": config.qdrant_port,
        "timeout": config.qdrant_timeout_ms / 1000,
    }
    if config.qdrant_api_key:
        kwargs["api_key"] = config.qdrant_api_key
    if config.qdrant_use_grpc:
        kwargs["grpc_port"] = config.qdrant_grpc_port
        kwargs["prefer_grpc"] = True
    return AsyncQdrantClient(**kwargs)


async def check_qdrant_health(client: AsyncQdrantClient | None = None) -> dict:
    """Check Qdrant availability and return a status payload."""
    own_client = client is None
    qdrant_client = client or create_qdrant_client()
    try:
        collections = await qdrant_client.get_collections()
        return {
            "qdrant": "reachable",
            "collections": len(collections.collections),
        }
    except Exception as exc:  # pragma: no cover - network failures
        raise QdrantConnectionError(f"Qdrant health check failed: {exc}") from exc
    finally:
        if own_client:
            await qdrant_client.close()


@asynccontextmanager
async def qdrant_client_context():
    """Async context manager for the Qdrant client."""
    client = create_qdrant_client()
    try:
        yield client
    finally:
        await client.close()
