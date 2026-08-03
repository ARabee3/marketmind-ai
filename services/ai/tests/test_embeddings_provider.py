from typing import Literal
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
from app.embeddings.gemini_provider import GeminiEmbeddingProvider
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


def test_factory_returns_fake_provider_when_configured() -> None:
    from app.core.config import Settings

    settings = Settings(
        embedding_provider_mode="fake",
        embedding_model="text-embedding-3-large",
        embedding_dimensions=3072,
    )
    provider = EmbeddingProviderFactory.from_settings(settings)
    assert provider.name == "fake"
    assert provider.config.model == "text-embedding-3-large"
    assert provider.config.dimensions == 3072


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


def test_gemini_provider_requires_api_key(fake_config: EmbeddingConfig) -> None:
    with pytest.raises(EmbeddingProviderError) as exc_info:
        GeminiEmbeddingProvider(fake_config, api_key="")
    assert exc_info.value.code == "EMBEDDING_PROVIDER_NOT_CONFIGURED"
    assert not exc_info.value.retryable


def test_gemini_provider_rejects_retired_model(fake_config: EmbeddingConfig) -> None:
    config = fake_config.model_copy(
        update={"provider": "gemini", "model": "text-embedding-004", "dimensions": 768}
    )

    with pytest.raises(EmbeddingProviderError) as exc_info:
        GeminiEmbeddingProvider(config, api_key="test-key")

    assert exc_info.value.code == "EMBEDDING_MODEL_RETIRED"
    assert not exc_info.value.retryable


@pytest.mark.anyio
async def test_gemini_provider_embeds_texts(fake_config: EmbeddingConfig) -> None:
    config = fake_config.model_copy(update={"provider": "gemini", "dimensions": 768})
    provider = GeminiEmbeddingProvider(config, api_key="test-key")

    class FakeEmbedding:
        def __init__(self, values: list[float]) -> None:
            self.values = values

    class FakeResponse:
        def __init__(self) -> None:
            self.embeddings = [
                FakeEmbedding([0.1] * 768),
                FakeEmbedding([0.2] * 768),
            ]

    def _fake_embed(*args, **kwargs):
        return FakeResponse()

    with patch("google.genai.Client") as mock_client_cls:
        mock_client = mock_client_cls.return_value
        mock_client.models.embed_content.side_effect = _fake_embed
        response = await provider.embed(EmbedRequest(texts=["hello", "world"]))

    assert response.provider == "gemini"
    assert response.model == config.model
    assert response.dimensions == 768
    assert len(response.embeddings) == 2
    assert response.embeddings[0].text == "hello"
    assert response.embeddings[1].text == "world"
    assert len(response.embeddings[0].vector) == 768


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("purpose", "expected_contents"),
    [
        (
            "retrieval_query",
            [
                "task: search result | query: زيادة مبيعات محل حلويات",
                "task: search result | query: منافسون محليون",
            ],
        ),
        (
            "retrieval_document",
            [
                "title: none | text: دليل تسويق محلي",
                "title: none | text: قاعدة اختيار القناة",
            ],
        ),
    ],
)
async def test_gemini_embedding_2_preserves_one_vector_per_formatted_input(
    fake_config: EmbeddingConfig,
    purpose: Literal["retrieval_query", "retrieval_document"],
    expected_contents: list[str],
) -> None:
    config = fake_config.model_copy(
        update={"provider": "gemini", "model": "gemini-embedding-2", "dimensions": 768}
    )
    provider = GeminiEmbeddingProvider(config, api_key="test-key")

    class FakeEmbedding:
        def __init__(self, values: list[float]) -> None:
            self.values = values

    class FakeResponse:
        def __init__(self, value: float) -> None:
            self.embeddings = [FakeEmbedding([value] * 768)]

    with patch("google.genai.Client") as mock_client_cls:
        embed_content = mock_client_cls.return_value.models.embed_content
        embed_content.side_effect = [FakeResponse(0.1), FakeResponse(0.2)]

        response = await provider.embed(
            EmbedRequest(
                texts=["زيادة مبيعات محل حلويات", "منافسون محليون"]
                if purpose == "retrieval_query"
                else ["دليل تسويق محلي", "قاعدة اختيار القناة"],
                purpose=purpose,
            )
        )

    assert len(response.embeddings) == 2
    assert [embedding.index for embedding in response.embeddings] == [0, 1]
    assert [
        call.kwargs["contents"] for call in embed_content.call_args_list
    ] == expected_contents


@pytest.mark.anyio
async def test_gemini_provider_maps_errors_without_exposing_input(
    fake_config: EmbeddingConfig,
) -> None:
    config = fake_config.model_copy(update={"provider": "gemini", "dimensions": 768})
    provider = GeminiEmbeddingProvider(config, api_key="test-key")

    with patch("google.genai.Client") as mock_client_cls:
        mock_client = mock_client_cls.return_value
        mock_client.models.embed_content.side_effect = RuntimeError("boom")

        with pytest.raises(EmbeddingProviderError) as exc_info:
            await provider.embed(EmbedRequest(texts=["private customer data"]))

    assert exc_info.value.code == "EMBEDDING_PROVIDER_ERROR"
    assert exc_info.value.retryable
    assert "private customer data" not in str(exc_info.value)


def test_factory_returns_gemini_provider_when_configured() -> None:
    with patch("app.embeddings.factory.get_settings") as mock_get_settings:
        mock_get_settings.return_value = type(
            "Settings",
            (),
            {
                "embedding_provider_mode": "gemini",
                "embedding_model": "gemini-embedding-2",
                "embedding_dimensions": 768,
                "embedding_batch_size": 32,
                "embedding_request_timeout_ms": 60000,
                "gemini_api_key": "test-key",
            },
        )()
        provider = EmbeddingProviderFactory.from_settings()
        assert provider.name == "gemini"
        assert provider.config.model == "gemini-embedding-2"
