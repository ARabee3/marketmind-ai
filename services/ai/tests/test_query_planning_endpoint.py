from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings, get_settings
from app.main import create_app
from test_query_planning_fixtures import FakeGeminiClient, payload


def test_internal_query_plan_endpoint() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_provider_mode="mock")
    client = TestClient(app)

    response = client.post("/internal/v1/ai/search/query-plan", json=payload())

    app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "deterministic"
    assert body["queries"][1]["intent"] == "competitor_discovery"


def test_internal_query_plan_endpoint_uses_configured_llm_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from google import genai

    monkeypatch.setattr(genai, "Client", FakeGeminiClient)

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        ai_provider_mode="gemini_dev",
        ai_request_timeout_ms=30_000,
        gemini_api_key="test-key",
        gemini_model="gemini-test",
    )
    client = TestClient(app)

    response = client.post("/internal/v1/ai/search/query-plan", json=payload())

    app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "llm"
    assert body["queries"][0]["query"] == "llm-business_match"
