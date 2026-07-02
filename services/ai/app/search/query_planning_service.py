from typing import Final, Protocol, assert_never

from app.discovery.schemas import LanguageMode, PreparedDiscoveryIntake
from app.providers.base import ProviderError
from app.search.schemas import PlannedSearchQuery, QueryPlan, QueryPlanningRequest

MAX_OWNER_COMPETITORS: Final = 5


class LlmQueryPlanner(Protocol):
    async def plan(self, request: QueryPlanningRequest) -> QueryPlan: ...


class QueryPlanningService:
    def __init__(self, llm_planner: LlmQueryPlanner | None = None) -> None:
        self.llm_planner = llm_planner

    async def plan(self, request: QueryPlanningRequest) -> QueryPlan:
        if self.llm_planner is not None:
            try:
                llm_plan = await self.llm_planner.plan(request)
                return QueryPlan(
                    source="llm",
                    queries=llm_plan.queries,
                    warnings=llm_plan.warnings,
                )
            except ProviderError as exc:
                fallback = self._deterministic_plan(request)
                return QueryPlan(
                    source="deterministic",
                    queries=fallback.queries,
                    warnings=[*fallback.warnings, f"{exc.code}: {exc}"],
                )

        return self._deterministic_plan(request)

    def _deterministic_plan(self, request: QueryPlanningRequest) -> QueryPlan:
        intake = request.intake
        language = request.language_mode
        queries = [
            self._business_match(intake, language),
            self._competitors(intake, language),
            self._market_context(intake, language),
            self._review_presence(intake, language),
            *self._known_competitors(intake, language),
            *self._social_profiles(intake, language),
        ]

        return QueryPlan(source="deterministic", queries=queries)

    def _business_match(
        self,
        intake: PreparedDiscoveryIntake,
        language: LanguageMode,
    ) -> PlannedSearchQuery:
        return PlannedSearchQuery(
            intent="business_match",
            query=_quoted([intake.business_name, intake.business_type, _location(intake)]),
            language=language,
            priority=100,
            provider_hints=["serpapi", "duckduckgo"],
        )

    def _competitors(
        self,
        intake: PreparedDiscoveryIntake,
        language: LanguageMode,
    ) -> PlannedSearchQuery:
        location = _location(intake)
        match language:
            case "ar-EG":
                query = f"أفضل {intake.business_type} في {location} منافسين"
            case "en" | "mixed":
                query = f"best {intake.business_type} in {location} competitors"
            case unreachable:
                assert_never(unreachable)

        return PlannedSearchQuery(
            intent="competitor_discovery",
            query=query,
            language=language,
            priority=95,
            provider_hints=["serpapi", "apify_google_maps", "duckduckgo"],
        )

    def _market_context(
        self,
        intake: PreparedDiscoveryIntake,
        language: LanguageMode,
    ) -> PlannedSearchQuery:
        location = _location(intake)
        match language:
            case "ar-EG":
                query = f"اتجاهات سوق {intake.business_type} في {location}"
            case "en" | "mixed":
                query = f"{intake.business_type} market trends in {location}"
            case unreachable:
                assert_never(unreachable)

        return PlannedSearchQuery(
            intent="market_context",
            query=query,
            language=language,
            priority=70,
            provider_hints=["serpapi", "duckduckgo"],
        )

    def _review_presence(
        self,
        intake: PreparedDiscoveryIntake,
        language: LanguageMode,
    ) -> PlannedSearchQuery:
        return PlannedSearchQuery(
            intent="review_presence",
            query=f"{_quoted([intake.business_name, _location(intake)])} reviews ratings",
            language=language,
            priority=85,
            provider_hints=["serpapi", "apify_google_maps", "duckduckgo"],
        )

    def _known_competitors(
        self,
        intake: PreparedDiscoveryIntake,
        language: LanguageMode,
    ) -> list[PlannedSearchQuery]:
        return [
            PlannedSearchQuery(
                intent="competitor_discovery",
                query=_quoted([competitor, _location(intake), intake.business_type]),
                language=language,
                priority=90 - index,
                provider_hints=["serpapi", "apify_google_maps", "duckduckgo"],
                metadata={"owner_provided_competitor": True},
            )
            for index, competitor in enumerate(
                _split_known_competitors(intake.known_competitors_text)
            )
        ]

    def _social_profiles(
        self,
        intake: PreparedDiscoveryIntake,
        language: LanguageMode,
    ) -> list[PlannedSearchQuery]:
        return [
            PlannedSearchQuery(
                intent="review_presence" if link.platform == "google_maps" else "social_profile",
                query=f"{_quoted([intake.business_name, _location(intake)])} {link.platform}",
                language=language,
                priority=80 - index,
                provider_hints=["apify_google_maps", "serpapi"]
                if link.platform == "google_maps"
                else ["metadata", "serpapi"],
                metadata={"owner_provided_url": link.url, "platform": link.platform},
            )
            for index, link in enumerate(intake.social_links)
        ]


def _location(intake: PreparedDiscoveryIntake) -> str:
    return ", ".join(part for part in [intake.area, intake.city] if part)


def _quoted(parts: list[str]) -> str:
    return " ".join(f'"{part}"' for part in parts if part)


def _split_known_competitors(value: str | None) -> list[str]:
    if not value:
        return []

    return [
        competitor.strip()
        for competitor in value.replace("،", ",").replace("\n", ",").split(",")
        if competitor.strip()
    ][:MAX_OWNER_COMPETITORS]
