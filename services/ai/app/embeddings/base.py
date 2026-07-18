from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field


class EmbeddingVector(BaseModel):
    """A single embedding vector with optional metadata."""

    text: str
    vector: list[float]
    index: int = Field(ge=0)


class EmbedRequest(BaseModel):
    """Batch embedding request."""

    texts: list[str] = Field(min_length=1)
    model: str | None = None
    dimensions: int | None = None


class EmbedResponse(BaseModel):
    """Batch embedding response."""

    embeddings: list[EmbeddingVector]
    model: str
    dimensions: int
    provider: str


class EmbeddingProviderError(Exception):
    """Raised when an embedding provider fails."""

    def __init__(self, code: str, message: str, retryable: bool = True) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(message)


class EmbeddingConfig(BaseModel):
    """Live embedding configuration."""

    provider: str
    model: str
    dimensions: int = Field(gt=0)
    batch_size: int = Field(default=32, ge=1, le=256)
    version: str = "embedding-v1"


class EmbeddingProvider(ABC):
    """Abstract adapter for text embedding providers."""

    name: str
    config: EmbeddingConfig

    def __init__(self, config: EmbeddingConfig) -> None:
        self.config = config

    @abstractmethod
    async def embed(self, request: EmbedRequest) -> EmbedResponse:
        """Embed a batch of texts."""
        raise NotImplementedError

    def _validate_dimensions(self, vector: list[float], index: int) -> None:
        actual = len(vector)
        expected = self.config.dimensions
        if actual != expected:
            raise EmbeddingProviderError(
                "EMBEDDING_DIMENSION_MISMATCH",
                f"Expected {expected} dimensions for {self.config.model}, "
                f"got {actual} at embedding index {index}",
                retryable=False,
            )

    def _validate_response(self, response: EmbedResponse) -> None:
        for embedding in response.embeddings:
            self._validate_dimensions(embedding.vector, embedding.index)

    def dump_config(self) -> dict[str, Any]:
        return {
            "provider": self.config.provider,
            "model": self.config.model,
            "dimensions": self.config.dimensions,
            "batch_size": self.config.batch_size,
            "version": self.config.version,
        }
