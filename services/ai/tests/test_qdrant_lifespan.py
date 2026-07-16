from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.main import _ensure_qdrant_collection_on_startup
from app.qdrant import QdrantConnectionError


@pytest.mark.anyio
async def test_lifespan_ensures_collection_on_startup() -> None:
    mock_client = AsyncMock()
    mock_config = MagicMock()
    mock_config.qdrant.collection_name = "test_collection"
    mock_config.embedding.dimensions = 3072

    with (
        patch("app.main.get_rag_config", return_value=mock_config),
        patch("app.main.create_qdrant_client", return_value=mock_client),
        patch("app.main.ensure_collection") as mock_ensure,
        patch("app.main.validate_collection_compatibility") as mock_validate,
        patch("app.main.create_payload_indexes") as mock_indexes,
    ):
        await _ensure_qdrant_collection_on_startup()

    mock_ensure.assert_awaited_once_with(
        mock_client,
        collection_name="test_collection",
        vector_size=3072,
    )
    mock_validate.assert_awaited_once_with(
        mock_client,
        collection_name="test_collection",
        expected_size=3072,
    )
    mock_indexes.assert_awaited_once_with(
        mock_client,
        collection_name="test_collection",
    )
    mock_client.close.assert_awaited_once()


@pytest.mark.anyio
async def test_lifespan_logs_warning_when_qdrant_unreachable() -> None:
    mock_client = AsyncMock()
    mock_config = MagicMock()
    mock_config.qdrant.collection_name = "test_collection"
    mock_config.embedding.dimensions = 3072

    with (
        patch("app.main.get_rag_config", return_value=mock_config),
        patch("app.main.create_qdrant_client", return_value=mock_client),
        patch("app.main.ensure_collection") as mock_ensure,
        patch("app.main.validate_collection_compatibility") as mock_validate,
        patch("app.main.create_payload_indexes") as mock_indexes,
    ):
        mock_ensure.side_effect = QdrantConnectionError("Qdrant is down")

        # Should not raise
        await _ensure_qdrant_collection_on_startup()

    mock_client.close.assert_awaited_once()
    mock_validate.assert_not_awaited()
    mock_indexes.assert_not_awaited()
