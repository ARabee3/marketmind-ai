from app.rag import build_rag_config


def test_rag_config_matches_defaults() -> None:
    config = build_rag_config()
    assert config.embedding.provider == "fake"
    assert config.embedding.model == "text-embedding-3-large"
    assert config.embedding.dimensions == 3072
    assert config.qdrant.collection_name == "marketing_knowledge_v1"


def test_rag_config_retrieval_metadata() -> None:
    config = build_rag_config()
    metadata = config.retrieval_metadata()
    assert metadata["embedding_provider"] == "fake"
    assert metadata["embedding_model"] == "text-embedding-3-large"
    assert metadata["embedding_dimensions"] == 3072
    assert metadata["collection_name"] == "marketing_knowledge_v1"
    assert metadata["retrieval_latency_ms"] == 0
