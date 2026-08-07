from app.rag import build_rag_config


def test_rag_config_matches_env() -> None:
    from app.core.config import get_settings

    settings = get_settings()
    config = build_rag_config()
    assert config.embedding.provider == settings.embedding_provider_mode
    assert config.embedding.model == settings.embedding_model
    assert config.embedding.dimensions == settings.embedding_dimensions
    assert config.qdrant.collection_name == settings.qdrant_collection_name
    assert config.selection_mode == settings.rag_selection_mode
    assert config.mmr_lambda == settings.rag_mmr_lambda


def test_rag_config_retrieval_metadata() -> None:
    from app.core.config import get_settings

    settings = get_settings()
    config = build_rag_config()
    metadata = config.retrieval_metadata()
    assert metadata["embedding_provider"] == settings.embedding_provider_mode
    assert metadata["embedding_model"] == settings.embedding_model
    assert metadata["embedding_dimensions"] == settings.embedding_dimensions
    assert metadata["collection_name"] == settings.qdrant_collection_name
    assert metadata["retrieval_latency_ms"] == 0


def test_rag_config_retrieval_metadata_matches_contract() -> None:
    from strategy_contracts import RetrievalMetadata

    config = build_rag_config()
    metadata = config.retrieval_metadata()
    validated = RetrievalMetadata.model_validate(metadata)
    assert validated.embedding_provider == config.embedding.provider
    assert validated.embedding_model == config.embedding.model
    assert validated.embedding_dimensions == config.embedding.dimensions
    assert validated.collection_name == config.qdrant.collection_name
