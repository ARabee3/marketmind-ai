from typing import Literal

from pydantic import Field

from app.discovery.schemas import LanguageMode, PreparedDiscoveryIntake, StrictModel

QueryPlanSource = Literal["llm", "deterministic"]
SearchQueryIntent = Literal[
    "business_match",
    "competitor_discovery",
    "market_context",
    "social_profile",
    "review_presence",
]
SearchProviderHint = Literal[
    "serpapi",
    "duckduckgo",
    "apify_google_maps",
    "metadata",
]
MetadataValue = str | int | float | bool


class QueryPlanningRequest(StrictModel):
    language_mode: LanguageMode = "mixed"
    intake: PreparedDiscoveryIntake


class PlannedSearchQuery(StrictModel):
    intent: SearchQueryIntent
    query: str
    language: LanguageMode
    priority: int = Field(ge=1, le=100)
    provider_hints: list[SearchProviderHint]
    metadata: dict[str, MetadataValue] = Field(default_factory=dict)


class QueryPlan(StrictModel):
    source: QueryPlanSource
    queries: list[PlannedSearchQuery] = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list)
