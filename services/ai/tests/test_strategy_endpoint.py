"""Tests for the /internal/v1/ai/strategy/* endpoints."""

from fastapi.testclient import TestClient

from app.main import app

from tests.decisions.fixtures.base import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
)


def test_retrieve_knowledge_endpoint_exists():
    client = TestClient(app)

    # Just checking the route is mounted and fails with 422 if empty body
    response = client.post("/internal/v1/ai/strategy/retrieve")
    assert response.status_code == 422  # Unprocessable Entity (Missing params)


def test_score_strategy_endpoint_requires_body():
    client = TestClient(app)
    response = client.post("/internal/v1/ai/strategy/score")
    assert response.status_code == 422


def test_score_strategy_endpoint_rejects_invalid_body():
    client = TestClient(app)
    response = client.post(
        "/internal/v1/ai/strategy/score",
        json={"business_profile": {"id": "invalid"}},
    )
    assert response.status_code == 422


def test_score_strategy_endpoint_returns_bundle():
    client = TestClient(app)
    profile = default_business_profile()
    brief = default_brief()
    pack = default_retrieval_pack()
    response = client.post(
        "/internal/v1/ai/strategy/score",
        json={
            "business_profile": profile.model_dump(mode="json"),
            "brief": brief.model_dump(mode="json"),
            "retrieval_pack": pack.model_dump(mode="json"),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert "deterministic_channel_scores" in body
    assert "selected_channels" in body
    assert "channel_explanations" in body
    assert "budget_scenarios" in body
    assert "kpi_targets" in body
