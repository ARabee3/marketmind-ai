from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from app.search.llm_evidence_triage import (
    OpenRouterEvidenceTriagePlanner,
    create_evidence_triage_planner,
)


def payload() -> dict[str, object]:
    return {
        "language_mode": "mixed",
        "intake": {
            "business_name": "Koshary Corner",
            "business_type": "restaurant",
            "city": "Cairo",
            "area": "Nasr City",
            "social_links": [],
        },
        "candidates": [
            {
                "index": 0,
                "intent": "competitor_discovery",
                "provider": "serpapi",
                "title": "Nearby restaurant",
                "url": "https://example.com/nearby",
                "snippet": "Popular restaurant in Nasr City Cairo.",
                "query": "best restaurants in Nasr City competitors",
                "rank": 1,
                "provider_confidence": 0.9,
                "metadata": {"rating": 4.5},
            }
        ],
    }


def test_internal_evidence_triage_endpoint_uses_mock_ai_decision() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_provider_mode="mock")
    client = TestClient(app)

    response = client.post("/internal/v1/ai/search/evidence-triage", json=payload())

    app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "llm"
    assert body["decisions"][0]["classification"] == "competitor"
    assert body["decisions"][0]["evidence_tier"] == "confirmed_signal"


def test_openrouter_triage_uses_dedicated_timeout() -> None:
    planner = create_evidence_triage_planner(
        Settings(
            ai_provider_mode="openrouter",
            discovery_triage_timeout_ms=180_000,
            open_router_api_key="test-key",
            open_router_model="openrouter-test",
        )
    )

    assert isinstance(planner, OpenRouterEvidenceTriagePlanner)
    assert planner.timeout_seconds == 180
