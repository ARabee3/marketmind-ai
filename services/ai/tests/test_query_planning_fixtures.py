from types import SimpleNamespace
from typing import Final

from app.search.schemas import (
    PlannedSearchQuery,
    QueryPlan,
    SearchProviderHint,
    SearchQueryIntent,
)

PayloadValue = str | dict[str, str | list[dict[str, str]]]
REQUIRED_INTENTS: Final[tuple[SearchQueryIntent, ...]] = (
    "business_match",
    "competitor_discovery",
    "market_context",
    "review_presence",
    "social_profile",
)


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


def planned_query(
    intent: SearchQueryIntent,
    query: str,
    provider_hints: list[SearchProviderHint] | None = None,
) -> PlannedSearchQuery:
    hints = provider_hints
    if hints is None:
        hints = (
            ["apify_google_maps", "serpapi", "duckduckgo"]
            if intent == "competitor_discovery"
            else ["serpapi"]
        )

    return PlannedSearchQuery(
        intent=intent,
        query=query,
        language="mixed",
        priority=100,
        provider_hints=hints,
    )


def competitor_only_plan() -> QueryPlan:
    return QueryPlan(
        source="llm",
        queries=[planned_query("competitor_discovery", "competitors in Cairo")],
    )


def complete_llm_plan() -> QueryPlan:
    return QueryPlan(
        source="llm",
        queries=[planned_query(intent, f"llm-{intent}") for intent in REQUIRED_INTENTS],
    )


def bad_competitor_provider_order_plan() -> QueryPlan:
    return QueryPlan(
        source="llm",
        queries=[
            planned_query(
                "competitor_discovery",
                "llm-competitor_discovery",
                ["serpapi", "apify_google_maps", "duckduckgo"],
            ),
            *[
                planned_query(intent, f"llm-{intent}")
                for intent in REQUIRED_INTENTS
                if intent != "competitor_discovery"
            ],
        ],
    )


class FakeGeminiClient:
    def __init__(self, api_key: str) -> None:
        self.models = FakeGeminiModels()


class FakeGeminiModels:
    def generate_content(self, **kwargs) -> SimpleNamespace:
        config = kwargs["config"]
        if getattr(config, "response_schema", None) is not None:
            raise ValueError("additionalProperties unsupported")

        return SimpleNamespace(text=complete_llm_plan().model_dump_json())
