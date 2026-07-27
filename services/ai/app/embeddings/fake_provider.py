import hashlib
import re

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

    Produces stable, reproducible vectors derived from token SHA-256 hashes.
    Vectors are normalized to unit length so cosine similarity reflects
    keyword similarity deterministically in tests.
    """

    name = "fake"

    def __init__(self, config: EmbeddingConfig) -> None:
        super().__init__(config)

    def _word_vector(self, word: str) -> np.ndarray:
        seed = int(hashlib.sha256(word.encode("utf-8")).hexdigest()[:16], 16)
        rng = np.random.default_rng(seed)
        vec = rng.standard_normal(self.config.dimensions).astype(np.float32)
        norm = np.linalg.norm(vec)
        return vec / (norm if norm != 0 else 1.0)

    def _generate_vector(self, text: str) -> list[float]:
        words = re.findall(r"\w+", text.lower())
        if not words:
            words = [text]
        composite = np.zeros(self.config.dimensions, dtype=np.float32)
        for w in words:
            weight = 2.0 if len(w) > 3 else 1.0
            composite += weight * self._word_vector(w)
        norm = np.linalg.norm(composite)
        if norm == 0:
            norm = 1.0
        return (composite / norm).tolist()

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
