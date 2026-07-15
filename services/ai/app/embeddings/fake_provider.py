import hashlib

import numpy as np

from app.embeddings.base import (
    EmbedRequest,
    EmbedResponse,
    EmbeddingConfig,
    EmbeddingProvider,
    EmbeddingVector,
)


class DeterministicFakeEmbeddingProvider(EmbeddingProvider):
    """Deterministic fake embedding provider for local development and tests.

    Produces stable, reproducible vectors from the SHA-256 hash of each input
    text. Vectors are normalized to unit length so cosine similarity behaves
    predictably in tests.
    """

    name = "fake"

    def __init__(self, config: EmbeddingConfig) -> None:
        super().__init__(config)

    def _generate_vector(self, text: str) -> list[float]:
        seed = int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:16], 16)
        rng = np.random.default_rng(seed)
        vector = rng.standard_normal(self.config.dimensions).astype(np.float32)
        norm = np.linalg.norm(vector)
        if norm == 0:
            norm = 1.0
        return (vector / norm).tolist()

    async def embed(self, request: EmbedRequest) -> EmbedResponse:
        embeddings = [
            EmbeddingVector(
                text=text,
                vector=self._generate_vector(text),
                index=idx,
            )
            for idx, text in enumerate(request.texts)
        ]
        response = EmbedResponse(
            embeddings=embeddings,
            model=request.model or self.config.model,
            dimensions=self.config.dimensions,
            provider=self.name,
        )
        self._validate_response(response)
        return response
