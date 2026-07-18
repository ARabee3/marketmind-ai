from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from app.embeddings.base import (
    EmbedRequest,
    EmbedResponse,
    EmbeddingConfig,
    EmbeddingProvider,
    EmbeddingProviderError,
    EmbeddingVector,
)


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """OpenAI embedding provider adapter."""

    name = "openai"

    def __init__(self, config: EmbeddingConfig, api_key: str, timeout_ms: int = 60_000) -> None:
        super().__init__(config)
        if not api_key:
            raise EmbeddingProviderError(
                "AI_PROVIDER_NOT_CONFIGURED",
                "OPENAI_API_KEY is required when EMBEDDING_PROVIDER_MODE=openai",
                retryable=False,
            )
        self._client = AsyncOpenAI(api_key=api_key, timeout=timeout_ms / 1000)

    @staticmethod
    def _map_provider_error(exc: Exception) -> EmbeddingProviderError:
        """Map SDK failures without exposing request content or credentials."""
        retryable = False
        details = [type(exc).__name__]

        if isinstance(exc, APIConnectionError):
            retryable = True
        elif isinstance(exc, APIStatusError):
            status_code = exc.status_code
            retryable = status_code in {408, 409, 429} or status_code >= 500
            details.append(f"status={status_code}")
            if exc.request_id:
                details.append(f"request_id={exc.request_id}")

        return EmbeddingProviderError(
            "EMBEDDING_PROVIDER_ERROR",
            f"OpenAI embedding request failed ({', '.join(details)})",
            retryable=retryable,
        )

    async def embed(self, request: EmbedRequest) -> EmbedResponse:
        model = request.model or self.config.model
        try:
            response = await self._client.embeddings.create(
                input=request.texts,
                model=model,
                dimensions=request.dimensions or self.config.dimensions,
                encoding_format="float",
            )
        except Exception as exc:
            raise self._map_provider_error(exc) from None

        embeddings = [
            EmbeddingVector(
                text=request.texts[item.index],
                vector=list(item.embedding),
                index=item.index,
            )
            for item in response.data
        ]
        result = EmbedResponse(
            embeddings=embeddings,
            model=model,
            dimensions=request.dimensions or self.config.dimensions,
            provider=self.name,
        )
        self._validate_response(result)
        return result
