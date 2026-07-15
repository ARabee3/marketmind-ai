from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ProviderMode = Literal["mock", "openai", "gemini_dev", "openrouter"]
EmbeddingProviderMode = Literal["openai", "fake"]


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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
