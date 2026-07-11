from typing import Final, assert_never

from app.discovery.schemas import LanguageMode, PreparedDiscoveryIntake
from app.search.schemas import (
    PlannedSearchQuery,
    QueryPlan,
    QueryPlanningRequest,
    SearchQueryIntent,
)

MAX_OWNER_COMPETITORS: Final = 5
MAX_QUERY_PLAN_SIZE: Final = 8
REQUIRED_QUERY_INTENTS: Final[tuple[SearchQueryIntent, ...]] = (
    "business_match",
    "competitor_discovery",
    "market_context",
    "review_presence",
)
SOCIAL_QUERY_INTENT: Final[SearchQueryIntent] = "social_profile"


def build_deterministic_query_plan(request: QueryPlanningRequest) -> QueryPlan:
    intake = request.intake
    language = request.language_mode
    queries = _bounded_unique_queries(
        [
            _business_match(intake, language),
            _competitors(intake, language),
            _market_context(intake, language),
            _review_presence(intake, language),
            *_social_profiles(intake, language),
            *_known_competitors(intake, language),
        ]
    )

    return QueryPlan(source="deterministic", queries=queries)


def _business_match(
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
        provider_hints=["apify_google_maps", "serpapi", "duckduckgo"],
    )


def _market_context(
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
    intake: PreparedDiscoveryIntake,
    language: LanguageMode,
) -> list[PlannedSearchQuery]:
    return [
        PlannedSearchQuery(
            intent="competitor_discovery",
            query=_quoted([competitor, _location(intake), intake.business_type]),
            language=language,
            priority=90 - index,
            provider_hints=["apify_google_maps", "serpapi", "duckduckgo"],
            metadata={"owner_provided_competitor": True},
        )
        for index, competitor in enumerate(
            _split_known_competitors(intake.known_competitors_text)
        )
    ]


def _social_profiles(
    intake: PreparedDiscoveryIntake,
    language: LanguageMode,
) -> list[PlannedSearchQuery]:
    if not intake.social_links:
        return []

    queries: list[PlannedSearchQuery] = []
    social_link = next(
        (link for link in intake.social_links if link.platform != "google_maps"),
        intake.social_links[0],
    )
    queries.append(
        PlannedSearchQuery(
            intent=SOCIAL_QUERY_INTENT,
            query=f"{_quoted([intake.business_name, _location(intake)])} {social_link.platform}",
            language=language,
            priority=80,
            provider_hints=["serpapi", "duckduckgo"],
            metadata={
                "owner_provided_url": social_link.url,
                "platform": social_link.platform,
            },
        )
    )

    google_maps_link = next(
        (link for link in intake.social_links if link.platform == "google_maps"),
        None,
    )
    if google_maps_link is not None:
        queries.append(
            PlannedSearchQuery(
                intent="review_presence",
                query=f"{_quoted([intake.business_name, _location(intake)])} reviews ratings",
                language=language,
                priority=79,
                provider_hints=["serpapi", "apify_google_maps", "duckduckgo"],
                metadata={
                    "owner_provided_url": google_maps_link.url,
                    "platform": google_maps_link.platform,
                },
            )
        )

    return queries


def _bounded_unique_queries(
    queries: list[PlannedSearchQuery],
) -> list[PlannedSearchQuery]:
    bounded_queries: list[PlannedSearchQuery] = []
    seen: set[str] = set()

    for query in queries:
        normalized = query.query.casefold()
        if normalized in seen:
            continue
        bounded_queries.append(query)
        seen.add(normalized)
        if len(bounded_queries) == MAX_QUERY_PLAN_SIZE:
            break

    return bounded_queries


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
