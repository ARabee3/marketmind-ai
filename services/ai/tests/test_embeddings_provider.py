import pytest

from app.embeddings import EmbedRequest
from app.embeddings.base import EmbeddingConfig, EmbeddingProviderError
from app.embeddings.factory import EmbeddingProviderFactory
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.embeddings.openai_provider import OpenAIEmbeddingProvider


@pytest.fixture
def fake_config() -> EmbeddingConfig:
    return EmbeddingConfig(
        provider="fake",
        model="text-embedding-3-small",
        dimensions=1536,
        batch_size=32,
    )


@pytest.mark.anyio
async def test_fake_provider_returns_unit_vectors(fake_config: EmbeddingConfig) -> None:
    provider = DeterministicFakeEmbeddingProvider(fake_config)
    response = await provider.embed(EmbedRequest(texts=["hello"]))
    assert len(response.embeddings) == 1
    vector = response.embeddings[0].vector
    assert len(vector) == 1536


@pytest.mark.anyio
async def test_fake_provider_is_deterministic(fake_config: EmbeddingConfig) -> None:
    provider = DeterministicFakeEmbeddingProvider(fake_config)
    response_a = await provider.embed(EmbedRequest(texts=["hello world"]))
    response_b = await provider.embed(EmbedRequest(texts=["hello world"]))
    assert response_a.embeddings[0].vector == response_b.embeddings[0].vector


@pytest.mark.anyio
async def test_fake_provider_different_texts_different_vectors(
    fake_config: EmbeddingConfig,
) -> None:
    provider = DeterministicFakeEmbeddingProvider(fake_config)
    response = await provider.embed(EmbedRequest(texts=["hello", "world"]))
    assert response.embeddings[0].vector != response.embeddings[1].vector


def test_factory_returns_fake_provider_by_default() -> None:
    provider = EmbeddingProviderFactory.from_settings()
    assert provider.name == "fake"
    assert provider.config.model == "text-embedding-3-small"


def test_openai_provider_requires_api_key(fake_config: EmbeddingConfig) -> None:
    with pytest.raises(EmbeddingProviderError) as exc_info:
        OpenAIEmbeddingProvider(fake_config, api_key="")
    assert exc_info.value.code == "AI_PROVIDER_NOT_CONFIGURED"
    assert not exc_info.value.retryable


@pytest.mark.anyio
async def test_dimension_validation(fake_config: EmbeddingConfig) -> None:
    provider = DeterministicFakeEmbeddingProvider(fake_config)
    response = await provider.embed(EmbedRequest(texts=["test"]))
    assert len(response.embeddings[0].vector) == fake_config.dimensions
