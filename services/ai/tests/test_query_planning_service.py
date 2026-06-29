from fastapi.testclient import TestClient

from app.main import create_app
from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import QueryPlanningRequest

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


def test_query_planner_includes_competitor_and_social_queries() -> None:
    request = QueryPlanningRequest.model_validate(payload())

    plan = QueryPlanningService().plan(request)

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


def test_query_planner_supports_arabic_queries() -> None:
    request = QueryPlanningRequest.model_validate(payload("ar-EG"))

    plan = QueryPlanningService().plan(request)

    assert plan.queries[1].query == (
        "أفضل quick service restaurant في Nasr City, Cairo منافسين"
    )
    assert plan.queries[2].query == (
        "اتجاهات سوق quick service restaurant في Nasr City, Cairo"
    )


def test_internal_query_plan_endpoint() -> None:
    client = TestClient(create_app())

    response = client.post("/internal/v1/ai/search/query-plan", json=payload())

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "deterministic"
    assert body["queries"][1]["intent"] == "competitor_discovery"
