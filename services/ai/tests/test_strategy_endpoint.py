from uuid import uuid4
from fastapi.testclient import TestClient

from app.main import app


def test_retrieve_knowledge_endpoint_exists():
    client = TestClient(app)
    
    # Just checking the route is mounted and fails with 422 if empty body
    response = client.post("/internal/v1/ai/strategy/retrieve")
    assert response.status_code == 422  # Unprocessable Entity (Missing params)
