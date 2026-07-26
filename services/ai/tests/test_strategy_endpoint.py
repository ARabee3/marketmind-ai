"""Tests for the /internal/v1/ai/strategy/* endpoints."""

from fastapi.testclient import TestClient

from strategy_contracts import ExternalBudgetMode

from app.main import app

from tests.decisions.fixtures.base import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
)


def test_retrieve_knowledge_endpoint_exists():
    route_paths = {
        nested_route.path
        for route in app.routes
        if hasattr(route, "original_router")
        for nested_route in route.original_router.routes
        if hasattr(nested_route, "path")
    }

    assert "/internal/v1/ai/strategy/retrieve" in route_paths


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
    assert "knowledge_gaps" in body


def test_score_strategy_endpoint_returns_blocking_budget_gap_for_unanchored_scenarios():
    client = TestClient(app)
    profile = default_business_profile()
    brief = default_brief(
        paid_media_allowed=True,
        budget_mode=ExternalBudgetMode.scenario_only,
        budget_egp=None,
    )
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
    assert body["budget_scenarios"] is None
    assert {
        "category": "budget:paid_media",
        "description": "Budget must be confirmed before paid-media scenarios can be generated.",
        "severity": "blocking",
    } in body["knowledge_gaps"]
