from typing import Final, Protocol, assert_never

import anyio
from app.providers.base import ProviderError
from app.search.deterministic_query_planner import (
    MAX_QUERY_PLAN_SIZE,
    REQUIRED_QUERY_INTENTS,
    SOCIAL_QUERY_INTENT,
    build_deterministic_query_plan,
)
from app.search.schemas import (
    PlannedSearchQuery,
    QueryPlan,
    QueryPlanningRequest,
    SearchProviderHint,
    SearchQueryIntent,
)

MIN_QUERY_PLAN_SIZE: Final = 4


class LlmQueryPlanner(Protocol):
    request_timeout_seconds: float

    async def plan(
        self,
        request: QueryPlanningRequest,
        correction_context: str | None = None,
    ) -> QueryPlan: ...


class QueryPlanningService:
    def __init__(self, llm_planner: LlmQueryPlanner | None = None) -> None:
        self.llm_planner = llm_planner

    async def plan(self, request: QueryPlanningRequest) -> QueryPlan:
        if self.llm_planner is None:
            return build_deterministic_query_plan(request)

        correction_context: str | None = None
        warning: str | None = None

        with anyio.move_on_after(self.llm_planner.request_timeout_seconds) as deadline:
            for attempt in range(2):
                try:
                    llm_plan = await self.llm_planner.plan(
                        request,
                        correction_context=correction_context,
                    )
                except ProviderError as exc:
                    warning = self._provider_warning(exc)
                    continue

                validation_warning = self._validation_warning(request, llm_plan)
                if validation_warning is None:
                    return QueryPlan(
                        source="llm",
                        queries=llm_plan.queries,
                        warnings=llm_plan.warnings,
                    )

                warning = validation_warning
                if attempt == 0:
                    correction_context = self._correction_context(validation_warning)

        if deadline.cancelled_caught:
            timeout_error = ProviderError(
                "LLM_QUERY_PLAN_TIMEOUT",
                "LLM query planning exceeded the total request deadline.",
                retryable=True,
            )
            warning = self._provider_warning(timeout_error)

        return self._fallback_plan(request, warning)

    def _missing_required_intents(
        self,
        request: QueryPlanningRequest,
        plan: QueryPlan,
    ) -> tuple[SearchQueryIntent, ...]:
        required = self._required_intents(request)
        present = {query.intent for query in plan.queries}
        return tuple(intent for intent in required if intent not in present)

    def _required_intents(
        self,
        request: QueryPlanningRequest,
    ) -> tuple[SearchQueryIntent, ...]:
        intents = list(REQUIRED_QUERY_INTENTS)
        if request.intake.social_links:
            intents.append(SOCIAL_QUERY_INTENT)
        return tuple(intents)

    def _has_valid_plan_shape(self, plan: QueryPlan) -> bool:
        return (
            MIN_QUERY_PLAN_SIZE <= len(plan.queries) <= MAX_QUERY_PLAN_SIZE
            and len({query.query.casefold() for query in plan.queries}) == len(plan.queries)
        )

    def _has_valid_provider_order(self, plan: QueryPlan) -> bool:
        return all(self._has_valid_query_provider_order(query) for query in plan.queries)

    def _has_valid_query_provider_order(self, query: PlannedSearchQuery) -> bool:
        first_provider = self._first_provider(query.provider_hints)
        match query.intent:
            case "competitor_discovery":
                return first_provider == "apify_google_maps"
            case "business_match" | "market_context" | "social_profile" | "review_presence":
                return first_provider == "serpapi"
            case unreachable:
                assert_never(unreachable)

    def _first_provider(
        self,
        provider_hints: list[SearchProviderHint],
    ) -> SearchProviderHint | None:
        if not provider_hints:
            return None
        return provider_hints[0]

    def _validation_warning(
        self,
        request: QueryPlanningRequest,
        plan: QueryPlan,
    ) -> str | None:
        missing_intents = self._missing_required_intents(request, plan)
        if missing_intents:
            return self._incomplete_warning(missing_intents)
        if not self._has_valid_plan_shape(plan):
            return self._invalid_shape_warning()
        if not self._has_valid_provider_order(plan):
            return self._invalid_provider_order_warning()
        return None

    def _correction_context(self, validation_warning: str) -> str:
        return (
            f"Previous plan rejected. {validation_warning} Return 4 to 8 unique "
            "queries covering every required intent. Use apify_google_maps first "
            "for competitor_discovery and serpapi first for every other query."
        )

    def _incomplete_warning(
        self,
        missing_intents: tuple[SearchQueryIntent, ...],
    ) -> str:
        return (
            "LLM_QUERY_PLAN_INCOMPLETE: Missing required intents after 2 attempts: "
            f"{', '.join(missing_intents)}."
        )

    def _invalid_shape_warning(self) -> str:
        return "LLM_QUERY_PLAN_INVALID_SHAPE: Query plan must contain 4 to 8 unique queries."

    def _invalid_provider_order_warning(self) -> str:
        return (
            "LLM_QUERY_PLAN_INVALID_PROVIDER_ORDER: competitor_discovery queries must "
            "use apify_google_maps first; all other queries must use serpapi first."
        )

    def _provider_warning(self, error: ProviderError) -> str:
        return f"{error.code}: {error}"

    def _fallback_plan(
        self,
        request: QueryPlanningRequest,
        warning: str | None,
    ) -> QueryPlan:
        fallback = build_deterministic_query_plan(request)
        warnings = fallback.warnings
        if warning is not None:
            warnings = [*warnings, warning]
        return QueryPlan(
            source="deterministic",
            queries=fallback.queries,
            warnings=warnings,
        )
