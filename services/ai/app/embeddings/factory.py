from app.core.config import Settings, get_settings
from app.embeddings.base import EmbeddingConfig, EmbeddingProvider
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.embeddings.openai_provider import OpenAIEmbeddingProvider


class EmbeddingProviderFactory:
    """Factory for embedding provider instances."""

    @staticmethod
    def from_settings(settings: Settings | None = None) -> EmbeddingProvider:
        config = settings or get_settings()
        embedding_config = EmbeddingConfig(
            provider=config.embedding_provider_mode,
            model=config.embedding_model,
            dimensions=config.embedding_dimensions,
            batch_size=config.embedding_batch_size,
        )

        if embedding_config.provider == "fake":
            return DeterministicFakeEmbeddingProvider(embedding_config)
        if embedding_config.provider == "openai":
            return OpenAIEmbeddingProvider(
                embedding_config,
                api_key=config.openai_api_key,
                timeout_ms=config.embedding_request_timeout_ms,
            )
        raise ValueError(
            f"Unsupported embedding provider mode: {embedding_config.provider}"
        )


def get_embedding_provider() -> EmbeddingProvider:
    """Return the configured embedding provider."""
    return EmbeddingProviderFactory.from_settings()
