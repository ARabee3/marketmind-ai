from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ProviderMode = Literal["mock", "openai", "gemini_dev", "openrouter"]
EmbeddingProviderMode = Literal["openai", "fake", "gemini"]
ImageProviderMode = Literal["mock", "openai", "gemini", "openrouter", "unavailable"]
AssetStorageProvider = Literal["filesystem", "r2", "unavailable"]


class Settings(BaseSettings):
    ai_provider_mode: ProviderMode = "mock"
    ai_request_timeout_ms: int = Field(default=30_000, ge=1_000, le=120_000)
    discovery_triage_timeout_ms: int = Field(default=120_000, ge=1_000, le=300_000)
    openai_api_key: str = ""
    openai_model: str = ""
    gemini_api_key: str = ""
    gemini_model: str = ""
    open_router_api_key: str = ""
    open_router_model: str = ""
    ai_temperature: float | None = Field(default=None, ge=0, le=2)
    ai_top_p: float | None = Field(default=None, ge=0, le=1)

    # In-memory per-client fixed-window rate limit on AI HTTP endpoints.
    # 0 disables limiting (local mock development default).
    ai_rate_limit_per_minute: int = Field(default=0, ge=0)

    # Static-image provider configuration. The image provider is deliberately
    # separate from text generation so unavailable media remains explicit.
    image_provider_mode: ImageProviderMode = "mock"
    image_model: str = "gpt-image-1"
    image_request_timeout_ms: int = Field(default=120_000, ge=1_000, le=300_000)
    content_asset_storage_dir: str = ""

    # Content asset storage backend: filesystem dir or Cloudflare R2.
    asset_storage_provider: AssetStorageProvider = "filesystem"
    cloudflare_r2_access_key_id: str = ""
    cloudflare_r2_secret_access_key: str = ""
    cloudflare_r2_bucket: str = ""
    cloudflare_r2_endpoint: str = ""
    cloudflare_r2_use_path_style_endpoint: bool = True
    cloudflare_r2_request_timeout_ms: int = Field(
        default=30_000, ge=1_000, le=300_000
    )

    # Embedding provider configuration
    # Default production configuration per STRATEGY_AGENT_AND_CURATED_RAG_ARCHITECTURE.md.
    embedding_provider_mode: EmbeddingProviderMode = "fake"
    embedding_model: str = "text-embedding-3-large"
    embedding_dimensions: int = Field(default=3072, ge=1, le=16_000)
    embedding_batch_size: int = Field(default=32, ge=1, le=256)
    embedding_request_timeout_ms: int = Field(default=60_000, ge=1_000, le=300_000)

    # Qdrant vector database configuration
    qdrant_host: str = "localhost"
    qdrant_port: int = Field(default=6333, ge=1, le=65_535)
    qdrant_grpc_port: int = Field(default=6334, ge=1, le=65_535)
    qdrant_collection_name: str = "marketing_knowledge_v1"
    qdrant_api_key: str | None = None
    qdrant_timeout_ms: int = Field(default=10_000, ge=1_000, le=60_000)
    qdrant_use_grpc: bool = False

    # PostgreSQL connection (schema owned by apps/api; FastAI reads/writes
    # the knowledge tables directly via SQLAlchemy).
    database_url: str = ""

    # Knowledge ingestion CLI authentication.
    # Required for the CLI; runtime FastAPI endpoints do not use it.
    knowledge_internal_cli_token: str = ""

    # Knowledge ingestion CLI configuration.
    knowledge_source_dir: str = "Docs/marketing-knowledge"
    knowledge_chunk_min_tokens: int = Field(default=300, ge=1, le=10_000)
    knowledge_chunk_max_tokens: int = Field(default=500, ge=1, le=10_000)
    knowledge_chunk_overlap_tokens: int = Field(default=50, ge=0, le=1_000)
    knowledge_strict_sources: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
