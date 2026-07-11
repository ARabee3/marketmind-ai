import anyio
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from app.providers.base import ProviderError
from app.search.llm_query_planner import (
    GeminiQueryPlanner,
    OpenRouterQueryPlanner,
    QUERY_PLAN_SYSTEM_PROMPT,
    create_llm_query_planner,
)
from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import QueryPlan, QueryPlanningRequest
from test_query_planning_fixtures import (
    FakeGeminiClient,
    bad_competitor_provider_order_plan,
    complete_llm_plan,
    competitor_only_plan,
    payload,
)


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
        "social_profile",
        "competitor_discovery",
        "competitor_discovery",
    ]
    assert plan.queries[1].provider_hints == [
        "apify_google_maps",
        "serpapi",
        "duckduckgo",
    ]
    assert plan.queries[-1].metadata == {"owner_provided_competitor": True}


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


def test_llm_query_prompt_is_industry_neutral() -> None:
    assert "Egyptian SME" in QUERY_PLAN_SYSTEM_PROMPT
    assert "business_type" in QUERY_PLAN_SYSTEM_PROMPT
    assert "city/area" in QUERY_PLAN_SYSTEM_PROMPT
    assert "Egyptian cafe/restaurant" not in QUERY_PLAN_SYSTEM_PROMPT


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("language_mode", "business_type", "location", "forbidden_terms"),
    [
        ("en", "pharmacy retail", "Heliopolis, Cairo", ["restaurant", "cafe"]),
        ("mixed", "accounting office", "Maadi, Cairo", ["restaurant", "cafe"]),
        ("ar-EG", "مركز تعليم لغات", "سموحة, الإسكندرية", ["مطعم", "كافيه", "مقهى"]),
    ],
)
async def test_query_planner_uses_actual_non_hospitality_business_type(
    language_mode: str,
    business_type: str,
    location: str,
    forbidden_terms: list[str],
) -> None:
    request_payload = payload(language_mode)
    request_payload["intake"].update(
        {
            "business_name": "Representative SME",
            "business_type": business_type,
            "city": location.split(", ")[1],
            "area": location.split(", ")[0],
            "known_competitors_text": "",
            "social_links": [],
        }
    )
    request = QueryPlanningRequest.model_validate(request_payload)

    plan = await QueryPlanningService().plan(request)

    query_text = "\n".join(query.query for query in plan.queries).lower()
    assert business_type.lower() in query_text
    assert location.lower() in query_text
    assert all(term not in query_text for term in forbidden_terms)


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
    assert planner.timeout_ms == 13_500


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
    assert planner.timeout_seconds == 13.5


@pytest.mark.anyio
async def test_query_planner_uses_llm_first_when_available() -> None:
    request = QueryPlanningRequest.model_validate(payload())

    plan = await QueryPlanningService(StaticLlmQueryPlanner()).plan(request)

    assert plan.source == "llm"
    assert [query.query for query in plan.queries] == [
        "llm-business_match",
        "llm-competitor_discovery",
        "llm-market_context",
        "llm-review_presence",
        "llm-social_profile",
    ]


@pytest.mark.anyio
async def test_incomplete_llm_plan_is_corrected_on_second_attempt() -> None:
    request = QueryPlanningRequest.model_validate(payload())
    planner = SequenceLlmQueryPlanner([competitor_only_plan(), complete_llm_plan()])

    plan = await QueryPlanningService(planner).plan(request)

    assert plan.source == "llm"
    assert {query.intent for query in plan.queries} == {
        "business_match",
        "competitor_discovery",
        "market_context",
        "review_presence",
        "social_profile",
    }
    assert planner.corrections[0] is None
    assert planner.corrections[1] is not None


@pytest.mark.anyio
async def test_second_incomplete_llm_plan_falls_back_visibly() -> None:
    request = QueryPlanningRequest.model_validate(payload())
    planner = SequenceLlmQueryPlanner([competitor_only_plan(), competitor_only_plan()])

    plan = await QueryPlanningService(planner).plan(request)

    assert planner.corrections[0] is None
    assert planner.corrections[1] is not None
    assert plan.source == "deterministic"
    assert plan.warnings == [
        "LLM_QUERY_PLAN_INCOMPLETE: Missing required intents after 2 attempts: "
        "business_match, market_context, review_presence, social_profile."
    ]


@pytest.mark.anyio
async def test_bad_competitor_provider_order_is_corrected_on_second_attempt() -> None:
    request = QueryPlanningRequest.model_validate(payload())
    planner = SequenceLlmQueryPlanner(
        [bad_competitor_provider_order_plan(), complete_llm_plan()]
    )

    plan = await QueryPlanningService(planner).plan(request)

    assert plan.source == "llm"
    assert planner.corrections[0] is None
    assert planner.corrections[1] is not None
    assert plan.queries[1].provider_hints[0] == "apify_google_maps"


@pytest.mark.anyio
async def test_second_bad_provider_order_plan_falls_back_visibly() -> None:
    request = QueryPlanningRequest.model_validate(payload())
    planner = SequenceLlmQueryPlanner(
        [bad_competitor_provider_order_plan(), bad_competitor_provider_order_plan()]
    )

    plan = await QueryPlanningService(planner).plan(request)

    assert plan.source == "deterministic"
    assert planner.corrections[0] is None
    assert planner.corrections[1] is not None
    assert plan.warnings == [
        "LLM_QUERY_PLAN_INVALID_PROVIDER_ORDER: competitor_discovery queries must "
        "use apify_google_maps first; all other queries must use serpapi first."
    ]


@pytest.mark.anyio
async def test_llm_attempts_share_total_deadline() -> None:
    request = QueryPlanningRequest.model_validate(payload())
    planner = SlowSequenceLlmQueryPlanner([competitor_only_plan(), complete_llm_plan()])

    plan = await QueryPlanningService(planner).plan(request)

    assert planner.call_count == 2
    assert plan.source == "deterministic"
    assert plan.warnings == [
        "LLM_QUERY_PLAN_TIMEOUT: LLM query planning exceeded the total request deadline."
    ]


@pytest.mark.anyio
async def test_flaky_provider_is_called_exactly_twice() -> None:
    request = QueryPlanningRequest.model_validate(payload())
    planner = FlakyLlmQueryPlanner()

    plan = await QueryPlanningService(planner).plan(request)

    assert plan.source == "llm"
    assert planner.call_count == 2


@pytest.mark.anyio
async def test_query_planner_falls_back_when_llm_fails() -> None:
    request = QueryPlanningRequest.model_validate(payload())

    plan = await QueryPlanningService(FailingLlmQueryPlanner()).plan(request)

    assert plan.source == "deterministic"
    assert plan.queries[1].intent == "competitor_discovery"
    assert plan.warnings == ["LLM_QUERY_PLAN_FAILED: planner unavailable"]


class StaticLlmQueryPlanner:
    request_timeout_seconds = 30.0

    async def plan(
        self,
        request: QueryPlanningRequest,
        correction_context: str | None = None,
    ) -> QueryPlan:
        return complete_llm_plan()


class FailingLlmQueryPlanner:
    request_timeout_seconds = 30.0

    async def plan(
        self,
        request: QueryPlanningRequest,
        correction_context: str | None = None,
    ) -> QueryPlan:
        raise ProviderError(
            "LLM_QUERY_PLAN_FAILED",
            "planner unavailable",
            retryable=True,
        )


class SequenceLlmQueryPlanner:
    request_timeout_seconds = 30.0

    def __init__(self, plans: list[QueryPlan]) -> None:
        self.plans = plans
        self.corrections: list[str | None] = []

    async def plan(
        self,
        request: QueryPlanningRequest,
        correction_context: str | None = None,
    ) -> QueryPlan:
        self.corrections.append(correction_context)
        return self.plans[len(self.corrections) - 1]


class SlowSequenceLlmQueryPlanner:
    request_timeout_seconds = 0.05

    def __init__(self, plans: list[QueryPlan]) -> None:
        self.plans = plans
        self.call_count = 0

    async def plan(
        self,
        request: QueryPlanningRequest,
        correction_context: str | None = None,
    ) -> QueryPlan:
        self.call_count += 1
        await anyio.sleep(0.04)
        return self.plans[self.call_count - 1]


class FlakyLlmQueryPlanner:
    request_timeout_seconds = 30.0

    def __init__(self) -> None:
        self.call_count = 0

    async def plan(
        self,
        request: QueryPlanningRequest,
        correction_context: str | None = None,
    ) -> QueryPlan:
        self.call_count += 1
        if self.call_count == 1:
            raise ProviderError("LLM_QUERY_PLAN_FAILED", "flaky", retryable=True)
        return complete_llm_plan()
