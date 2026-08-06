import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Make shared Python contracts importable at runtime, not only under pytest.
_CONTRACTS_PYTHON = Path(__file__).parent.parent.parent.parent / "packages" / "contracts" / "python"
if str(_CONTRACTS_PYTHON) not in sys.path:
    sys.path.insert(0, str(_CONTRACTS_PYTHON))

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.internal_v1.discovery import router as discovery_router
from app.api.internal_v1.content import router as content_router
from app.api.internal_v1.search import router as search_router
from app.api.internal_v1.strategy import router as strategy_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.ratelimit import RateLimitMiddleware
from app.qdrant import (
    create_payload_indexes,
    create_qdrant_client,
    ensure_collection,
    validate_collection_compatibility,
)
from app.rag import get_rag_config


async def _ensure_qdrant_collection_on_startup() -> None:
    """Ensure the configured Qdrant collection exists, is compatible, and has payload indexes; log on failure."""
    config = get_rag_config()
    client = create_qdrant_client()
    try:
        await ensure_collection(
            client,
            collection_name=config.qdrant.collection_name,
            vector_size=config.embedding.dimensions,
            embedding_provider=config.embedding.provider,
            embedding_model=config.embedding.model,
            embedding_version=config.embedding.version,
        )
        await validate_collection_compatibility(
            client,
            collection_name=config.qdrant.collection_name,
            expected_size=config.embedding.dimensions,
            expected_provider=config.embedding.provider,
            expected_model=config.embedding.model,
            expected_version=config.embedding.version,
        )
        await create_payload_indexes(
            client,
            collection_name=config.qdrant.collection_name,
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


def create_app(rate_limit_per_minute: int | None = None) -> FastAPI:
    configure_logging()
    if rate_limit_per_minute is None:
        rate_limit_per_minute = get_settings().ai_rate_limit_per_minute
    app = FastAPI(
        title="MarketMind AI Service",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(RateLimitMiddleware, limit_per_minute=rate_limit_per_minute)
    app.include_router(health_router)
    app.include_router(discovery_router)
    app.include_router(content_router)
    app.include_router(search_router)
    app.include_router(strategy_router)
    return app


app = create_app()
