"""Async SQLAlchemy engine and session factory for the AI service."""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.config import Settings, get_settings


def _to_asyncpg_url(url: str) -> str:
    """Convert a standard PostgreSQL URL to the asyncpg dialect.

    NestJS/Prisma uses `postgresql://...`; SQLAlchemy asyncpg expects
    `postgresql+asyncpg://...`.
    """
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def create_async_engine_from_settings(settings: Settings | None = None):
    """Create an async SQLAlchemy engine from application settings."""
    config = settings or get_settings()
    if not config.database_url:
        raise RuntimeError(
            "DATABASE_URL is not configured. Set it in services/ai/.env to use the knowledge CLI."
        )
    return create_async_engine(
        _to_asyncpg_url(config.database_url),
        future=True,
        echo=False,
    )


AsyncSessionLocal = async_sessionmaker(
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncSession:
    """Yield an async database session bound to the configured engine.

    This is a low-level helper for scripts and tests; prefer explicit
    engine/session management in production code.
    """
    engine = create_async_engine_from_settings()
    session = AsyncSessionLocal(bind=engine)
    try:
        yield session
    finally:
        await session.close()
        await engine.dispose()


async def close_db() -> None:
    """No-op placeholder for callers expecting a close helper.

    The engine is created per-session in this module; dispose is handled
    automatically by `get_db`.
    """
    pass
