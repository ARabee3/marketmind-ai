import uuid

import pytest

from app.core.config import Settings
from app.embeddings import EmbeddingConfig, get_embedding_provider
from app.embeddings.base import EmbeddingProvider
from app.qdrant import create_qdrant_client


@pytest.fixture
def embedding_config() -> EmbeddingConfig:
    return EmbeddingConfig(
        provider="fake",
        model="text-embedding-3-large",
        dimensions=3072,
        batch_size=32,
    )


@pytest.fixture
def fake_embedding_provider(embedding_config: EmbeddingConfig) -> EmbeddingProvider:
    return get_embedding_provider()


@pytest.fixture
def qdrant_test_settings() -> Settings:
    """Return settings with a unique test collection name."""
    return Settings(
        embedding_provider_mode="fake",
        embedding_model="text-embedding-3-large",
        embedding_dimensions=3072,
        qdrant_host="localhost",
        qdrant_port=6333,
        qdrant_collection_name=f"test_marketing_knowledge_{uuid.uuid4().hex[:12]}",
    )


@pytest.fixture
def test_collection_name(qdrant_test_settings: Settings) -> str:
    return qdrant_test_settings.qdrant_collection_name


@pytest.fixture
async def qdrant_test_client(qdrant_test_settings: Settings):
    """Provide an async Qdrant client connected to the local test collection.

    Skips the test if Qdrant is not reachable. The collection is deleted at the
    end of the test.
    """
    client = create_qdrant_client(qdrant_test_settings)
    try:
        await client.get_collections()
    except Exception as exc:
        pytest.skip(f"Qdrant is not reachable: {exc}")

    try:
        yield client
    finally:
        try:
            await client.delete_collection(
                collection_name=qdrant_test_settings.qdrant_collection_name
            )
        except Exception:
            pass
        await client.close()
