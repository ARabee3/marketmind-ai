from typing import Literal

EmbeddingProviderMode = Literal["openai", "fake"]
EmbeddingModel = Literal["text-embedding-3-small", "text-embedding-3-large"]

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMENSIONS = 1536
