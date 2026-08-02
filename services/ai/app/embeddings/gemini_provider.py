from typing import Any, Literal, assert_never

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

    Uses the `models.embed_content` endpoint with Gemini Embedding 2 retrieval
    formatting and one request per text to preserve vector cardinality.
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
        if config.model == "text-embedding-004":
            raise EmbeddingProviderError(
                "EMBEDDING_MODEL_RETIRED",
                "text-embedding-004 is retired; use gemini-embedding-2 and rebuild the index",
                retryable=False,
            )
        self._api_key = api_key
        self._timeout_ms = timeout_ms

    @staticmethod
    def _format_text(
        text: str,
        purpose: Literal["generic", "retrieval_query", "retrieval_document"],
    ) -> str:
        match purpose:
            case "generic":
                return text
            case "retrieval_query":
                return f"task: search result | query: {text}"
            case "retrieval_document":
                return f"title: none | text: {text}"
            case unreachable:
                assert_never(unreachable)

    def _call_gemini(
        self,
        texts: list[str],
        model: str,
        dimensions: int,
        purpose: Literal["generic", "retrieval_query", "retrieval_document"],
    ) -> EmbedResponse:
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
        embeddings: list[EmbeddingVector] = []
        if model == "gemini-embedding-2":
            for idx, text in enumerate(texts):
                response = client.models.embed_content(
                    model=model,
                    contents=self._format_text(text, purpose),
                    config=types.EmbedContentConfig(
                        output_dimensionality=dimensions,
                    ),
                )
                if len(response.embeddings) != 1:
                    raise EmbeddingProviderError(
                        "EMBEDDING_RESPONSE_INVALID",
                        "Gemini Embedding 2 must return exactly one vector per input",
                        retryable=False,
                    )
                embeddings.append(
                    EmbeddingVector(
                        text=text,
                        vector=list(response.embeddings[0].values),
                        index=idx,
                    )
                )
        else:
            response = client.models.embed_content(
                model=model,
                contents=texts,
                config=types.EmbedContentConfig(
                    output_dimensionality=dimensions,
                ),
            )
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
                request.purpose,
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
