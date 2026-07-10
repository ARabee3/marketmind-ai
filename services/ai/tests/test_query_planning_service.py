import anyio
import pytest

from app.providers.base import ProviderError
from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import QueryPlan, QueryPlanningRequest
from test_query_planning_fixtures import (
    bad_competitor_provider_order_plan,
    complete_llm_plan,
    competitor_only_plan,
    payload,
)


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
