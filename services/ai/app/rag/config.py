from dataclasses import dataclass

from app.core.config import Settings, get_settings
from app.embeddings import EmbeddingConfig


@dataclass(frozen=True)
class QdrantConfig:
    """Live Qdrant configuration used by RAG."""

    host: str
    port: int
    grpc_port: int
    collection_name: str
    api_key: str | None
    timeout_ms: int
    use_grpc: bool


@dataclass(frozen=True)
class RagConfig:
    """Live RAG configuration combining embedding and Qdrant settings."""

    embedding: EmbeddingConfig
    qdrant: QdrantConfig

    def retrieval_metadata(self) -> dict:
        """Return a dictionary matching the RetrievalMetadata contract fields."""
        return {
            "embedding_provider": self.embedding.provider,
            "embedding_model": self.embedding.model,
            "embedding_dimensions": self.embedding.dimensions,
            "collection_name": self.qdrant.collection_name,
            "retrieval_latency_ms": 0,
        }


def build_rag_config(settings: Settings | None = None) -> RagConfig:
    """Build the live RAG config from application settings."""
    config = settings or get_settings()
    return RagConfig(
        embedding=EmbeddingConfig(
            provider=config.embedding_provider_mode,
            model=config.embedding_model,
            dimensions=config.embedding_dimensions,
            batch_size=config.embedding_batch_size,
        ),
        qdrant=QdrantConfig(
            host=config.qdrant_host,
            port=config.qdrant_port,
            grpc_port=config.qdrant_grpc_port,
            collection_name=config.qdrant_collection_name,
            api_key=config.qdrant_api_key,
            timeout_ms=config.qdrant_timeout_ms,
            use_grpc=config.qdrant_use_grpc,
        ),
    )


def get_rag_config() -> RagConfig:
    return build_rag_config()
