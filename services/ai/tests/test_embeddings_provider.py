from unittest.mock import AsyncMock, patch

import httpx
import pytest
from openai import APITimeoutError, AuthenticationError, InternalServerError

from app.embeddings import EmbedRequest
from app.embeddings.base import (
    EmbedResponse,
    EmbeddingConfig,
    EmbeddingProviderError,
    EmbeddingVector,
)
from app.embeddings.factory import EmbeddingProviderFactory
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.embeddings.openai_provider import OpenAIEmbeddingProvider


@pytest.fixture
def fake_config() -> EmbeddingConfig:
    return EmbeddingConfig(
        provider="fake",
        model="text-embedding-3-large",
        dimensions=3072,
        batch_size=32,
    )


@pytest.mark.anyio
async def test_fake_provider_returns_unit_vectors(fake_config: EmbeddingConfig) -> None:
    provider = DeterministicFakeEmbeddingProvider(fake_config)
    response = await provider.embed(EmbedRequest(texts=["hello"]))
    assert len(response.embeddings) == 1
    vector = response.embeddings[0].vector
    assert len(vector) == 3072


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
    assert provider.config.model == "text-embedding-3-large"


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


def test_dimension_error_does_not_expose_input_text(
    fake_config: EmbeddingConfig,
) -> None:
    provider = DeterministicFakeEmbeddingProvider(fake_config)
    private_text = "private customer revenue and contact details"
    response = EmbedResponse(
        embeddings=[
            EmbeddingVector(text=private_text, vector=[0.1], index=0),
        ],
        model=fake_config.model,
        dimensions=1,
        provider="fake",
    )

    with pytest.raises(EmbeddingProviderError) as exc_info:
        provider._validate_response(response)

    assert private_text not in str(exc_info.value)
    assert not exc_info.value.retryable


def _status_error(error_type, status_code: int):
    request = httpx.Request("POST", "https://api.openai.com/v1/embeddings")
    response = httpx.Response(
        status_code,
        request=request,
        headers={"x-request-id": "req_test"},
    )
    return error_type("provider details must stay private", response=response, body=None)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("provider_error", "expected_retryable"),
    [
        (
            APITimeoutError(
                httpx.Request("POST", "https://api.openai.com/v1/embeddings")
            ),
            True,
        ),
        (_status_error(AuthenticationError, 401), False),
        (_status_error(InternalServerError, 500), True),
        (ValueError("private input must not be logged"), False),
    ],
)
async def test_openai_provider_maps_retryability_without_exposing_details(
    fake_config: EmbeddingConfig,
    provider_error: Exception,
    expected_retryable: bool,
) -> None:
    provider = OpenAIEmbeddingProvider(fake_config, api_key="test-key")

    with patch.object(
        provider._client.embeddings,
        "create",
        AsyncMock(side_effect=provider_error),
    ):
        with pytest.raises(EmbeddingProviderError) as exc_info:
            await provider.embed(EmbedRequest(texts=["private customer data"]))

    assert exc_info.value.retryable is expected_retryable
    assert "private customer data" not in str(exc_info.value)
    assert "provider details must stay private" not in str(exc_info.value)
    assert "private input must not be logged" not in str(exc_info.value)
    assert exc_info.value.__cause__ is None
