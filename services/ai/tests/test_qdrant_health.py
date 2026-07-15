from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import create_app
from app.qdrant.client import QdrantConnectionError


def test_health_endpoint_returns_service_status() -> None:
    app = create_app()
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "marketmind-ai-service"
    assert "qdrant" in data


def test_health_endpoint_reports_qdrant_unreachable() -> None:
    app = create_app()
    client = TestClient(app)

    with patch(
        "app.api.health.check_qdrant_health"
    ) as mock_check:
        mock_check.side_effect = QdrantConnectionError("Qdrant is down")
        response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["qdrant"] == "unreachable"
    assert "Qdrant is down" in data["qdrant_error"]
