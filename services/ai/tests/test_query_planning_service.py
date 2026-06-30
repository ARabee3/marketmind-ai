from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from app.providers.base import ProviderError
from app.search.llm_query_planner import (
    GeminiQueryPlanner,
    OpenRouterQueryPlanner,
    create_llm_query_planner,
)
from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import PlannedSearchQuery, QueryPlan, QueryPlanningRequest

PayloadValue = str | dict[str, str | list[dict[str, str]]]


def payload(language_mode: str = "mixed") -> dict[str, PayloadValue]:
    return {
        "language_mode": language_mode,
        "intake": {
            "business_name": "Koshary Corner",
            "business_type": "quick service restaurant",
            "city": "Cairo",
            "area": "Nasr City",
            "known_competitors_text": "Tahrir Koshary, Zooba",
            "social_links": [
                {
                    "platform": "instagram",
                    "url": "https://instagram.com/kosharycorner",
                },
                {
                    "platform": "google_maps",
                    "url": "https://maps.google.com/?cid=123",
                },
            ],
        },
    }


@pytest.mark.anyio
async def test_query_planner_includes_competitor_and_social_queries() -> None:
    request = QueryPlanningRequest.model_validate(payload())

    plan = await QueryPlanningService().plan(request)

    assert plan.source == "deterministic"
    assert [query.intent for query in plan.queries] == [
        "business_match",
        "competitor_discovery",
        "market_context",
        "review_presence",
        "competitor_discovery",
        "competitor_discovery",
        "social_profile",
        "review_presence",
    ]
    assert plan.queries[1].provider_hints == [
        "serpapi",
        "apify_google_maps",
        "duckduckgo",
    ]
    assert plan.queries[4].metadata == {"owner_provided_competitor": True}


@pytest.mark.anyio
async def test_query_planner_supports_arabic_queries() -> None:
    request = QueryPlanningRequest.model_validate(payload("ar-EG"))

    plan = await QueryPlanningService().plan(request)

    assert plan.queries[1].query == (
        "أفضل quick service restaurant في Nasr City, Cairo منافسين"
    )
    assert plan.queries[2].query == (
        "اتجاهات سوق quick service restaurant في Nasr City, Cairo"
    )


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
    assert body["queries"][0]["query"] == "configured provider competitors in Cairo"


def test_gemini_query_planner_keeps_timeout_in_milliseconds() -> None:
    planner = create_llm_query_planner(
        Settings(
            ai_provider_mode="gemini_dev",
            ai_request_timeout_ms=30_000,
            gemini_api_key="test-key",
            gemini_model="gemini-test",
        )
    )

    assert isinstance(planner, GeminiQueryPlanner)
    assert planner.timeout_ms == 30_000


def test_openrouter_query_planner_is_selected_from_provider_mode() -> None:
    planner = create_llm_query_planner(
        Settings(
            ai_provider_mode="openrouter",
            ai_request_timeout_ms=30_000,
            open_router_api_key="test-key",
            open_router_model="openrouter-test",
        )
    )

    assert isinstance(planner, OpenRouterQueryPlanner)
    assert planner.timeout_seconds == 30


@pytest.mark.anyio
async def test_query_planner_uses_llm_first_when_available() -> None:
    request = QueryPlanningRequest.model_validate(payload())

    plan = await QueryPlanningService(StaticLlmQueryPlanner()).plan(request)

    assert plan.source == "llm"
    assert plan.queries[0].query == "smart competitors in Nasr City"


@pytest.mark.anyio
async def test_query_planner_falls_back_when_llm_fails() -> None:
    request = QueryPlanningRequest.model_validate(payload())

    plan = await QueryPlanningService(FailingLlmQueryPlanner()).plan(request)

    assert plan.source == "deterministic"
    assert plan.queries[1].intent == "competitor_discovery"
    assert plan.warnings == ["LLM_QUERY_PLAN_FAILED: planner unavailable"]


class StaticLlmQueryPlanner:
    async def plan(self, request: QueryPlanningRequest) -> QueryPlan:
        return QueryPlan(
            source="llm",
            queries=[
                PlannedSearchQuery(
                    intent="competitor_discovery",
                    query=f"smart competitors in {request.intake.area}",
                    language=request.language_mode,
                    priority=100,
                    provider_hints=["serpapi", "apify_google_maps"],
                )
            ],
        )


class FailingLlmQueryPlanner:
    async def plan(self, request: QueryPlanningRequest) -> QueryPlan:
        raise ProviderError(
            "LLM_QUERY_PLAN_FAILED",
            "planner unavailable",
            retryable=True,
        )


class FakeGeminiClient:
    def __init__(self, api_key: str) -> None:
        self.models = FakeGeminiModels()


class FakeGeminiModels:
    def generate_content(self, **kwargs: object) -> SimpleNamespace:
        config = kwargs["config"]
        if getattr(config, "response_schema", None) is not None:
            raise ValueError("additionalProperties unsupported")

        return SimpleNamespace(
            text=QueryPlan(
                source="llm",
                queries=[
                    PlannedSearchQuery(
                        intent="competitor_discovery",
                        query="configured provider competitors in Cairo",
                        language="mixed",
                        priority=100,
                        provider_hints=["serpapi"],
                    )
                ],
            ).model_dump_json()
        )
