from typing import Any

from anyio import to_thread

from app.embeddings.base import (
    EmbedRequest,
    EmbedResponse,
    EmbeddingConfig,
    EmbeddingProvider,
    EmbeddingProviderError,
    EmbeddingVector,
)


class GeminiEmbeddingProvider(EmbeddingProvider):
    """Gemini embedding provider adapter using the google-genai SDK.

    Uses the `models.embed_content` endpoint. Supports models such as
    `text-embedding-004`.
    """

    name = "gemini"

    def __init__(self, config: EmbeddingConfig, api_key: str, timeout_ms: int = 60_000) -> None:
        super().__init__(config)
        if not api_key:
            raise EmbeddingProviderError(
                "EMBEDDING_PROVIDER_NOT_CONFIGURED",
                "GEMINI_API_KEY is required when EMBEDDING_PROVIDER_MODE=gemini",
                retryable=False,
            )
        self._api_key = api_key
        self._timeout_ms = timeout_ms

    def _call_gemini(self, texts: list[str], model: str, dimensions: int) -> EmbedResponse:
        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:
            raise EmbeddingProviderError(
                "EMBEDDING_PROVIDER_NOT_CONFIGURED",
                "The google-genai package is not installed.",
                retryable=False,
            ) from exc

        client = genai.Client(
            api_key=self._api_key,
            http_options=types.HttpOptions(timeout=self._timeout_ms),
        )
        response = client.models.embed_content(
            model=model,
            contents=texts,
            config=types.EmbedContentConfig(
                output_dimensionality=dimensions,
            ),
        )

        embeddings: list[EmbeddingVector] = []
        for idx, item in enumerate(response.embeddings):
            embeddings.append(
                EmbeddingVector(
                    text=texts[idx],
                    vector=list(item.values),
                    index=idx,
                )
            )

        return EmbedResponse(
            embeddings=embeddings,
            model=model,
            dimensions=dimensions,
            provider=self.name,
        )

    async def embed(self, request: EmbedRequest) -> EmbedResponse:
        model = request.model or self.config.model
        dimensions = request.dimensions or self.config.dimensions
        try:
            response = await to_thread.run_sync(
                self._call_gemini,
                request.texts,
                model,
                dimensions,
            )
        except EmbeddingProviderError:
            raise
        except Exception as exc:
            raise EmbeddingProviderError(
                "EMBEDDING_PROVIDER_ERROR",
                f"Gemini embedding request failed ({type(exc).__name__})",
                retryable=True,
            ) from exc

        self._validate_response(response)
        return response

    def dump_config(self) -> dict[str, Any]:
        return {
            "provider": self.config.provider,
            "model": self.config.model,
            "dimensions": self.config.dimensions,
            "batch_size": self.config.batch_size,
            "version": self.config.version,
        }
