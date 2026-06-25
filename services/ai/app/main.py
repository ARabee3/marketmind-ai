from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.internal_v1.discovery import router as discovery_router
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(title="MarketMind AI Service", version="0.1.0")
    app.include_router(health_router)
    app.include_router(discovery_router)
    return app


app = create_app()
