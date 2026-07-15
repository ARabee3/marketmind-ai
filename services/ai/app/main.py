from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.internal_v1.discovery import router as discovery_router
from app.api.internal_v1.search import router as search_router
from app.core.logging import configure_logging
from app.qdrant import create_qdrant_client, ensure_collection
from app.rag import get_rag_config


async def _ensure_qdrant_collection_on_startup() -> None:
    """Ensure the configured Qdrant collection exists; log on failure."""
    config = get_rag_config()
    client = create_qdrant_client()
    try:
        await ensure_collection(
            client,
            collection_name=config.qdrant.collection_name,
            vector_size=config.embedding.dimensions,
        )
    except Exception as exc:
        # Log but do not crash: discovery endpoints remain available while
        # Strategy endpoints will fail later with a retryable error if Qdrant
        # is still unreachable.
        import logging

        logger = logging.getLogger(__name__)
        logger.warning("Qdrant collection check failed on startup: %s", exc)
    finally:
        await client.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: ensure Qdrant collection exists on startup."""
    await _ensure_qdrant_collection_on_startup()
    yield


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="MarketMind AI Service",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(health_router)
    app.include_router(discovery_router)
    app.include_router(search_router)
    return app


app = create_app()
