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

    Produces stable, reproducible vectors using word-level hashing with
    weighted averaging — texts sharing keywords get similar vectors, 
    mimicking real embedding cosine similarity.

    How it works:
    1. Split text into words via regex (\\w+).
    2. For each word, generate a unit vector from a SHA-256 seeded RNG
       (same word → same vector, regardless of surrounding text).
    3. Weight: words longer than 3 chars get weight 2.0, others 1.0
       (prioritises meaningful tokens over short stopwords).
    4. Compute weighted average, then L2-normalise to unit length.

    This is *not* a bag-of-words TF-IDF or a learned embedding, but for
    test purposes it provides:
    - Determinism: same text → same vector, always.
    - Similarity signal: texts with overlapping keywords get correlated
      vectors (unlike whole-text SHA-256 hashing where every input is an
      independent random vector).
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
