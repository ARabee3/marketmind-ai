"""Async SQLAlchemy engine and session factory for the AI service."""

from urllib.parse import parse_qs, urlparse, urlunparse

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.config import Settings, get_settings


def _to_asyncpg_url(url: str) -> tuple[str, dict[str, str]]:
    """Convert a standard PostgreSQL URL to the asyncpg dialect.

    NestJS/Prisma uses `postgresql://...`; SQLAlchemy asyncpg expects
    `postgresql+asyncpg://...`. Prisma-style query parameters such as
    `?schema=public` are not valid asyncpg connection arguments, so they are
    stripped from the URL and returned separately as connect_args. The schema
    is applied via `server_settings={'search_path': ...}`.
    """
    parsed = urlparse(url)
    query_params = parse_qs(parsed.query)

    schema = None
    if "schema" in query_params:
        schema = query_params["schema"][0]
        del query_params["schema"]

    scheme = parsed.scheme
    if scheme == "postgresql":
        scheme = "postgresql+asyncpg"

    new_query = "&".join(
        f"{k}={v[0]}" for k, v in query_params.items()
    )
    new_url = urlunparse(
        (
            scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment,
        )
    )

    connect_args: dict[str, str] = {}
    if schema:
        connect_args["server_settings"] = {"search_path": schema}

    return new_url, connect_args


def create_async_engine_from_settings(settings: Settings | None = None):
    """Create an async SQLAlchemy engine from application settings."""
    config = settings or get_settings()
    if not config.database_url:
        raise RuntimeError(
            "DATABASE_URL is not configured. Set it in services/ai/.env to use the knowledge CLI."
        )
    url, connect_args = _to_asyncpg_url(config.database_url)
    return create_async_engine(
        url,
        future=True,
        echo=False,
        connect_args=connect_args,
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
