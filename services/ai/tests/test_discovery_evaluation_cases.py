import asyncio
from typing import Any

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app.core.config import Settings, get_settings
from app.main import create_app
from app.discovery.schemas import (
    AiDiscoveryRespondRequest,
    AiDiscoveryStartRequest,
    AiDiscoverySummarizeRequest,
    BusinessProfileDraft,
    DiscoveryModelOutput,
    IntelligenceResult,
    PreparedDiscoveryIntake,
    ResearchObservation,
    SourceRef,
    Uncertainty,
    UncertaintyInput,
)
from app.discovery.service import DiscoveryService
from app.providers.base import DiscoveryProvider, DiscoveryProviderRequest
from app.providers.mock_provider import MockDiscoveryProvider

SESSION_ID = "11111111-1111-4111-8111-111111111111"
OWNER_USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def base_intake(with_social_links: bool = True) -> dict[str, Any]:
    result: dict[str, Any] = {
        "business_name": "Koshary Corner",
        "business_type": "quick service restaurant",
        "city": "Cairo",
        "area": "Nasr City",
        "owner_goal_text": "Attract more lunch customers.",
    }
    if with_social_links:
        result["social_links"] = [
            {"platform": "instagram", "url": "https://www.instagram.com/kosharycorner.example"}
        ]
    return result


def base_payload(
    language_mode: str = "en",
    with_gap: bool = False,
    with_social_links: bool = True,
) -> dict[str, Any]:
    knowledge_gaps = []
    if with_gap:
        knowledge_gaps.append({
            "id": "77777777-7777-4777-8777-777777777777",
            "field_key": "primary_customer_segment",
            "question_hint": "Who buys most often today?",
            "priority": 1,
            "status": "open",
        })

    social_links_payload = []
    if with_social_links:
        social_links_payload = base_intake(with_social_links=True).get("social_links", [])

    intake = base_intake(with_social_links=with_social_links)
    intake["social_links"] = social_links_payload

    return {
        "session_id": SESSION_ID,
        "language_mode": language_mode,
        "intake": intake,
        "intelligence": {
            "status": "partial",
            "search_mode": "free_search",
            "source_refs": [],
            "research_observations": [],
            "conversation_hooks": [],
            "knowledge_gaps": knowledge_gaps,
        },
    }


def with_completion_context(
    payload: dict[str, Any],
    *,
    reason: str = "owner_finished_early",
    blocking_domains: list[str] | None = None,
) -> dict[str, Any]:
    domains = blocking_domains or [
        "offer",
        "customers",
        "differentiation",
        "current_marketing",
        "goals_and_constraints",
    ]
    scores = {
        "identity": 1.0,
        "offer": 0.3,
        "customers": 0.4,
        "differentiation": 0.1,
        "current_marketing": 0.4,
        "goals_and_constraints": 0.5,
        "market_context": 0.5,
        "research_confidence": 0.5,
        "profile_readiness": 0.45,
    }
    payload["completion_context"] = {
        "reason": reason,
        "completeness": "complete" if reason == "sufficient" else "incomplete",
        "readiness": {
            "ready": reason == "sufficient",
            "llm_recommended": reason == "sufficient",
            "profile_readiness": scores["profile_readiness"],
            "domain_scores": scores,
            "blocking_domains": domains,
            "owner_turn_count": 3,
            "max_owner_turns": 15,
            "completion_reason": reason,
        },
    }
    return payload


def owner_message(content: str, language: str = "en") -> dict[str, str]:
    return {
        "id": "22222222-2222-4222-8222-222222222222",
        "role": "owner",
        "content": content,
        "language": language,
        "source": "chat",
        "created_at": "2026-06-25T10:00:00Z",
    }


def assistant_message(content: str, language: str = "en") -> dict[str, str]:
    return {
        "id": "88888888-8888-4888-8888-888888888888",
        "role": "assistant",
        "content": content,
        "language": language,
        "source": "chat",
        "created_at": "2026-06-25T09:59:00Z",
    }


HOSPITALITY_TERMS = ("restaurant", "cafe", "مطعم", "كافيه", "مقهى")
REPRESENTATIVE_SME_CASES = [
    {
        "label": "retail",
        "language_mode": "en",
        "business_name": "Green Basket",
        "business_type": "neighborhood grocery retail",
        "city": "Cairo",
        "area": "Heliopolis",
        "owner_goal_text": "Increase repeat weekly shoppers.",
        "allows_hospitality_terms": False,
    },
    {
        "label": "professional_services",
        "language_mode": "mixed",
        "business_name": "Nile Ledger",
        "business_type": "accounting office",
        "city": "Cairo",
        "area": "Maadi",
        "owner_goal_text": "Bring in more monthly retainer clients.",
        "allows_hospitality_terms": False,
    },
    {
        "label": "education",
        "language_mode": "ar-EG",
        "business_name": "مركز النور",
        "business_type": "مركز تعليم لغات",
        "city": "الإسكندرية",
        "area": "سموحة",
        "owner_goal_text": "زيادة تسجيل الطلاب في كورسات المحادثة.",
        "allows_hospitality_terms": False,
    },
    {
        "label": "hospitality",
        "language_mode": "en",
        "business_name": "Koshary Corner",
        "business_type": "quick service restaurant",
        "city": "Cairo",
        "area": "Nasr City",
        "owner_goal_text": "Attract more lunch customers.",
        "allows_hospitality_terms": True,
    },
]


def representative_payload(case: dict[str, Any]) -> dict[str, Any]:
    payload = base_payload(
        str(case["language_mode"]),
        with_gap=True,
        with_social_links=False,
    )
    payload["intake"].update(
        {
            "business_name": case["business_name"],
            "business_type": case["business_type"],
            "city": case["city"],
            "area": case["area"],
            "owner_goal_text": case["owner_goal_text"],
        }
    )
    return payload


class ContradictionProvider(DiscoveryProvider):
    name = "contradiction"

    async def generate_structured(
        self,
        request: DiscoveryProviderRequest,
    ) -> DiscoveryModelOutput:
        return DiscoveryModelOutput(
            action="ask_clarification",
            ready_to_summarize=False,
            next_question="Which closing time is correct: 5pm or 11pm?",
            updated_known_facts={},
            updated_uncertainties=[
                UncertaintyInput(
                    domain="goals_and_constraints",
                    field_key="business_hours",
                    description="The owner gave conflicting closing times.",
                    severity="high",
                    category="contradiction",
                    source="owner_answer",
                    owner_stated_value="11pm every day",
                    contradiction_detail="The earlier answer said 5pm on weekends.",
                )
            ],
            domain_scores={},
        )


class CapturingProvider(DiscoveryProvider):
    name = "capturing"

    def __init__(self) -> None:
        self.last_request: DiscoveryProviderRequest | None = None

    async def generate_structured(
        self,
        request: DiscoveryProviderRequest,
    ) -> DiscoveryModelOutput:
        self.last_request = request
        return DiscoveryModelOutput(
            action="ask_next_question",
            ready_to_summarize=False,
            next_question="Who are your best current customers?",
            updated_known_facts={},
            updated_uncertainties=[],
            domain_scores={},
        )


class CapturingArabicProvider(DiscoveryProvider):
    name = "capturing-arabic"

    def __init__(self) -> None:
        self.last_request: DiscoveryProviderRequest | None = None

    async def generate_structured(
        self,
        request: DiscoveryProviderRequest,
    ) -> DiscoveryModelOutput:
        self.last_request = request
        return DiscoveryModelOutput(
            action="ask_next_question",
            ready_to_summarize=False,
            next_question=(
                "وجدت إشارات عن منافسين وحضور فيسبوك وسوق الحلويات في أسيوط. "
                "ما أكثر منتج يطلبه العملاء عندكم حاليا؟"
            ),
            updated_known_facts={},
            updated_uncertainties=[],
            domain_scores={},
        )


# ---------------------------------------------------------------------------
# Unknown / knowledge gap cases
# ---------------------------------------------------------------------------

def test_unknown_budget_is_tracked_as_uncertainty() -> None:
    payload = base_payload("en")
    payload["messages"] = [assistant_message("Do you have a marketing budget?")]
    payload["owner_message"] = owner_message("I don't know yet. Maybe later.")
    request = AiDiscoveryRespondRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).respond(request))

    assert result.action == "ask_next_question"
    uncertainties = result.updated_uncertainties
    assert len(uncertainties) > 0, "Unknown answer should produce at least one uncertainty"
    for u in uncertainties:
        assert u.severity in ("low", "medium", "high")
        assert u.category == "owner_unknown"
        assert u.source == "owner_unknown"
    assert any("unknown" in u.field_key.lower() for u in uncertainties), (
        "At least one uncertainty field_key should reference the unknown answer. "
        "Note: current mock uses generic 'owner_unknown_answer'. "
        "Real providers should use more specific field_keys like 'marketing_budget'."
    )


def test_unknown_competitors_is_tracked_as_uncertainty() -> None:
    payload = base_payload("en")
    payload["messages"] = [assistant_message("Who are your main competitors in Nasr City?")]
    payload["owner_message"] = owner_message("I am not sure. There are some shops but I do not know their names.")
    request = AiDiscoveryRespondRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).respond(request))

    assert result.action == "ask_next_question"
    uncertainties = result.updated_uncertainties
    assert len(uncertainties) > 0, "Unknown competitors should produce at least one uncertainty"
    for u in uncertainties:
        assert u.severity in ("low", "medium", "high")
        assert u.category == "owner_unknown"
        assert u.source == "owner_unknown"
    assert any("unknown" in u.field_key.lower() for u in uncertainties), (
        "At least one uncertainty field_key should reference the unknown answer. "
        "Note: current mock uses generic 'owner_unknown_answer'. "
        "Real providers should use more specific field_keys like 'competitors'."
    )


# ---------------------------------------------------------------------------
# Contradictory answer case
# ---------------------------------------------------------------------------

def test_contradictory_answer_tracked_as_uncertainty() -> None:
    payload = base_payload("en")
    payload["messages"] = [
        assistant_message("What are your peak hours?"),
        owner_message("1pm to 3pm weekdays."),
        assistant_message("And how late are you open on weekends?"),
        owner_message("We close at 5pm on weekends."),
    ]
    payload["owner_message"] = owner_message("Actually we close at 11pm every day. I was wrong earlier.")
    request = AiDiscoveryRespondRequest.model_validate(payload)
    result = run(DiscoveryService(ContradictionProvider()).respond(request))

    assert result.action == "ask_clarification"
    assert result.next_question == "Which closing time is correct: 5pm or 11pm?"
    assert len(result.updated_uncertainties) == 1
    contradiction = result.updated_uncertainties[0]
    assert contradiction.field_key == "business_hours"
    assert contradiction.category == "contradiction"
    assert contradiction.source == "owner_answer"
    assert contradiction.contradiction_detail is not None


# ---------------------------------------------------------------------------
# Cross-industry SME cases
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "case",
    REPRESENTATIVE_SME_CASES,
    ids=[str(case["label"]) for case in REPRESENTATIVE_SME_CASES],
)
def test_representative_sme_start_cases_are_industry_grounded(
    case: dict[str, Any],
) -> None:
    payload = representative_payload(case)
    request = AiDiscoveryStartRequest.model_validate(payload)

    result = run(DiscoveryService(MockDiscoveryProvider()).start(request))

    question = result.next_question or ""
    assert result.action == "ask_next_question"
    assert str(case["business_name"]) in question
    assert result.updated_known_facts.identity.business_type == case["business_type"]
    if not case["allows_hospitality_terms"]:
        lowered_question = question.lower()
        assert all(term not in lowered_question for term in HOSPITALITY_TERMS)


@pytest.mark.parametrize(
    "case",
    REPRESENTATIVE_SME_CASES,
    ids=[str(case["label"]) for case in REPRESENTATIVE_SME_CASES],
)
def test_representative_sme_summaries_preserve_submitted_identity(
    case: dict[str, Any],
) -> None:
    payload = representative_payload(case)
    payload["messages"] = [
        owner_message(
            f"{case['business_name']} serves a specific local customer base.",
            str(case["language_mode"]),
        )
    ]
    request = AiDiscoverySummarizeRequest.model_validate(
        with_completion_context(payload)
    )

    result = run(DiscoveryService(MockDiscoveryProvider()).summarize(request))

    assert result.profile_draft is not None
    identity = result.profile_draft.confirmed_facts.identity
    assert identity.business_name == case["business_name"]
    assert identity.business_type == case["business_type"]
    assert identity.city == case["city"]
    assert identity.area == case["area"]


# ---------------------------------------------------------------------------
# Social links cases
# ---------------------------------------------------------------------------

def test_start_with_social_links_includes_context() -> None:
    payload = base_payload("en", with_social_links=True)
    payload["intelligence"]["source_refs"] = [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "metadata",
            "platform": "instagram",
            "url": "https://www.instagram.com/kosharycorner.example",
            "title": "Koshary Corner",
            "snippet": "Egyptian comfort food in Nasr City",
            "fetched_at": "2026-06-25T10:00:05.000Z",
            "confidence": 0.86,
            "metadata": {},
        }
    ]
    payload["intelligence"]["research_observations"] = [
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "digital_presence",
            "statement": "Instagram describes Koshary Corner as Egyptian comfort food in Nasr City.",
            "confidence": 0.86,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {},
        }
    ]
    request = AiDiscoveryStartRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).start(request))

    assert result.action == "ask_next_question"
    assert result.next_question is not None
    assert len(result.source_refs) > 0
    assert len(result.research_observations) > 0


def test_start_without_social_links_still_succeeds() -> None:
    payload = base_payload("en", with_social_links=False)
    request = AiDiscoveryStartRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).start(request))

    assert result.action == "ask_next_question"
    assert result.next_question is not None


# ---------------------------------------------------------------------------
# Social links: metadata extraction scenarios
# ---------------------------------------------------------------------------

def test_metadata_extraction_adds_observations() -> None:
    payload = base_payload("en", with_social_links=True)
    payload["intelligence"]["source_refs"] = [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "metadata",
            "platform": "instagram",
            "url": "https://www.instagram.com/kosharycorner.example",
            "title": "Koshary Corner",
            "snippet": "Egyptian comfort food in Nasr City. 340 followers.",
            "fetched_at": "2026-06-25T10:00:05.000Z",
            "confidence": 0.86,
            "metadata": {"follower_count": 340, "last_post_date": "2026-05-15"},
        }
    ]
    payload["intelligence"]["research_observations"] = [
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "metadata",
            "statement": "Instagram has 340 followers and last posted 2026-05-15.",
            "confidence": 0.86,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {},
        }
    ]
    request = AiDiscoveryStartRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).start(request))

    assert result.action == "ask_next_question"
    observations = result.research_observations
    assert len(observations) >= 1
    metadata_obs = next((o for o in observations if o.kind == "metadata"), None)
    assert metadata_obs is not None
    assert metadata_obs.visibility == "owner_visible"
    assert metadata_obs.status == "accepted"


# ---------------------------------------------------------------------------
# Search partial failure case
# ---------------------------------------------------------------------------

def test_metadata_reachable_but_search_partial_failure() -> None:
    payload = base_payload("en", with_social_links=True)
    payload["intelligence"]["status"] = "partial"
    payload["intelligence"]["source_refs"] = [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "metadata",
            "platform": "instagram",
            "url": "https://www.instagram.com/kosharycorner.example",
            "title": "Koshary Corner",
            "snippet": "Egyptian comfort food in Nasr City.",
            "fetched_at": "2026-06-25T10:00:05.000Z",
            "confidence": 0.86,
            "metadata": {},
        }
    ]
    payload["intelligence"]["research_observations"] = [
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "digital_presence",
            "statement": "Instagram metadata extracted successfully.",
            "confidence": 0.86,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {},
        }
    ]
    payload["intelligence"]["safe_error"] = {
        "code": "DISCOVERY_RESEARCH_PARTIAL",
        "message": "Free search returned no usable results, but metadata extraction succeeded.",
        "retryable": False,
    }
    request = AiDiscoveryStartRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).start(request))

    assert result.action == "ask_next_question"
    assert result.next_question is not None
    assert len(result.research_observations) >= 1


# ---------------------------------------------------------------------------
# Wrong-match discard case
# ---------------------------------------------------------------------------

def test_wrong_match_discarded_not_in_ai_context() -> None:
    payload = base_payload("en", with_social_links=True)
    payload["intelligence"]["source_refs"] = [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "metadata",
            "platform": "instagram",
            "url": "https://www.instagram.com/kosharycorner.example",
            "title": "Koshary Corner",
            "snippet": "Egyptian comfort food in Nasr City.",
            "fetched_at": "2026-06-25T10:00:05.000Z",
            "confidence": 0.86,
            "metadata": {},
        },
        {
            "id": "33333333-3333-4333-8333-333333333333",
            "source_type": "search_result",
            "platform": "google_maps",
            "url": "https://maps.google.com/wrong-business",
            "title": "Wrong Koshary Branch",
            "snippet": "A different business in Downtown Cairo.",
            "fetched_at": "2026-06-25T10:00:06.000Z",
            "confidence": 0.31,
            "metadata": {},
        },
    ]
    payload["intelligence"]["research_observations"] = [
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "digital_presence",
            "statement": "Instagram metadata extracted successfully.",
            "confidence": 0.86,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {},
        },
        {
            "id": "55555555-5555-4555-8555-555555555555",
            "source_ref_id": "33333333-3333-4333-8333-333333333333",
            "kind": "competitor",
            "statement": "A Downtown branch is the owner's local competitor.",
            "confidence": 0.31,
            "visibility": "internal",
            "status": "discarded",
            "discard_reason": "The location does not match the owner's area.",
            "metadata": {},
        },
    ]

    request = AiDiscoveryStartRequest.model_validate(payload)
    provider = CapturingProvider()
    result = run(DiscoveryService(provider).start(request))

    assert provider.last_request is not None
    passed_observations = provider.last_request.payload["intelligence"][
        "research_observations"
    ]
    passed_sources = provider.last_request.payload["intelligence"]["source_refs"]
    assert [observation["id"] for observation in passed_observations] == [
        "44444444-4444-4444-8444-444444444444"
    ]
    assert [source["id"] for source in passed_sources] == [
        "22222222-2222-4222-8222-222222222222"
    ]
    assert [observation.id for observation in result.research_observations] == [
        "44444444-4444-4444-8444-444444444444"
    ]


def test_provider_payload_includes_structured_research_context_pack() -> None:
    payload = base_payload("en", with_social_links=True)
    payload["intelligence"]["source_refs"] = [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "search_result",
            "platform": "serpapi",
            "url": "https://example.com/competitor",
            "title": "Nearby Koshary",
            "snippet": "A nearby quick-service restaurant in Nasr City.",
            "fetched_at": "2026-06-25T10:00:05.000Z",
            "confidence": 0.82,
            "metadata": {
                "provider": "serpapi",
                "enrichment_status": "complete",
            },
        },
        {
            "id": "33333333-3333-4333-8333-333333333333",
            "source_type": "metadata",
            "platform": "instagram",
            "url": "https://www.instagram.com/kosharycorner.example",
            "title": "Koshary Corner",
            "snippet": "Egyptian comfort food in Nasr City.",
            "fetched_at": "2026-06-25T10:00:06.000Z",
            "confidence": 0.86,
            "metadata": {"provider": "owner_link"},
        },
        {
            "id": "99999999-9999-4999-8999-999999999999",
            "source_type": "search_result",
            "platform": "serpapi",
            "url": "https://example.com/wrong",
            "title": "Wrong city result",
            "confidence": 0.2,
            "metadata": {"provider": "serpapi"},
        },
    ]
    payload["intelligence"]["research_observations"] = [
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "competitor",
            "statement": "Nearby Koshary appears as a local competitor candidate.",
            "confidence": 0.82,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {
                "evidence_tier": "likely_signal",
                "suggested_owner_question": "Is Nearby Koshary a real competitor for you?",
            },
        },
        {
            "id": "55555555-5555-4555-8555-555555555555",
            "source_ref_id": "33333333-3333-4333-8333-333333333333",
            "kind": "social_signal",
            "statement": "Instagram describes Koshary Corner as Egyptian comfort food.",
            "confidence": 0.86,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {"evidence_tier": "confirmed_signal"},
        },
        {
            "id": "66666666-6666-4666-8666-666666666666",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "market_context",
            "statement": "Lunch demand appears visible in local quick-service results.",
            "confidence": 0.61,
            "visibility": "internal",
            "status": "accepted",
            "metadata": {"evidence_tier": "needs_confirmation"},
        },
        {
            "id": "77777777-7777-4777-8777-777777777777",
            "source_ref_id": "99999999-9999-4999-8999-999999999999",
            "kind": "competitor",
            "statement": "Wrong city result is a competitor.",
            "confidence": 0.2,
            "visibility": "internal",
            "status": "discarded",
            "discard_reason": "Wrong city.",
            "metadata": {"evidence_tier": "discarded"},
        },
    ]

    request = AiDiscoveryStartRequest.model_validate(payload)
    provider = CapturingProvider()
    run(DiscoveryService(provider).start(request))

    assert provider.last_request is not None
    context_pack = provider.last_request.payload["intelligence"]["research_context_pack"]
    assert [
        item["observation_id"] for item in context_pack["competitor_candidates"]
    ] == ["44444444-4444-4444-8444-444444444444"]
    assert [
        item["observation_id"] for item in context_pack["social_presence_signals"]
    ] == ["55555555-5555-4555-8555-555555555555"]
    assert [
        item["observation_id"] for item in context_pack["unconfirmed_findings"]
    ] == ["66666666-6666-4666-8666-666666666666"]
    assert context_pack["suggested_owner_questions"] == [
        {
            "observation_id": "44444444-4444-4444-8444-444444444444",
            "question": "Is Nearby Koshary a real competitor for you?",
        }
    ]
    all_context_ids = {
        item["observation_id"]
        for section in (
            "accepted_observations",
            "unconfirmed_findings",
            "competitor_candidates",
            "social_presence_signals",
            "market_context_signals",
        )
        for item in context_pack[section]
    }
    assert "77777777-7777-4777-8777-777777777777" not in all_context_ids
    assert context_pack["source_quality_notes"] == [
        {
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "platform": "serpapi",
            "provider": "serpapi",
            "confidence": 0.82,
            "enrichment_status": "complete",
        },
        {
            "source_ref_id": "33333333-3333-4333-8333-333333333333",
            "platform": "instagram",
            "provider": "owner_link",
            "confidence": 0.86,
            "enrichment_status": None,
        },
    ]


def test_arabic_start_passes_enriched_context_pack_to_provider() -> None:
    payload = base_payload("ar-EG", with_social_links=True)
    payload["intake"] = {
        "business_name": "قصر نابولي",
        "business_type": "محل حلويات",
        "city": "اسيوط",
        "area": "مدينة اسيوط",
        "owner_goal_text": "زياده البيعات",
        "known_competitors_text": "حلواني اخر ساعه",
        "target_audience_text": "الشباب و العائلات",
        "social_links": [
            {
                "platform": "facebook",
                "url": "https://www.facebook.com/kasrnapoly",
            }
        ],
    }
    payload["intelligence"]["source_refs"] = [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "owner_link",
            "platform": "facebook",
            "url": "https://www.facebook.com/kasrnapoly",
            "title": None,
            "snippet": None,
            "fetched_at": "2026-06-25T10:00:05.000Z",
            "confidence": 0.45,
            "metadata": {
                "owner_submitted": True,
                "metadata_fetch_status": "failed",
                "error_code": "METADATA_FETCH_FAILED",
            },
        },
        {
            "id": "33333333-3333-4333-8333-333333333333",
            "source_type": "search_result",
            "platform": "apify_google_maps",
            "url": "maps://placeid/akhersaah",
            "title": "حلواني اخر ساعه",
            "snippet": "محل حلويات قريب في مدينة أسيوط.",
            "fetched_at": "2026-06-25T10:00:06.000Z",
            "confidence": 0.82,
            "metadata": {
                "provider": "apify_google_maps",
                "enrichment_status": "complete",
            },
        },
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "source_type": "search_result",
            "platform": "serpapi",
            "url": "https://example.com/assiut-sweets",
            "title": "سوق الحلويات في أسيوط",
            "snippet": "بحث محلي عن محلات الحلويات في أسيوط.",
            "fetched_at": "2026-06-25T10:00:07.000Z",
            "confidence": 0.74,
            "metadata": {
                "provider": "serpapi",
                "enrichment_status": "complete",
                "visible_text_excerpt": "حلويات شرقية وتورت ومناسبات في أسيوط.",
            },
        },
    ]
    payload["intelligence"]["research_observations"] = [
        {
            "id": "55555555-5555-4555-8555-555555555555",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "social_signal",
            "statement": "رابط فيسبوك مقدم من صاحب النشاط لكن جلب الصفحة محجوب.",
            "confidence": 0.45,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {
                "evidence_tier": "needs_confirmation",
                "classification": "social_signal",
            },
        },
        {
            "id": "66666666-6666-4666-8666-666666666666",
            "source_ref_id": "33333333-3333-4333-8333-333333333333",
            "kind": "competitor",
            "statement": "حلواني اخر ساعه يظهر كمنافس محلي محتمل في أسيوط.",
            "confidence": 0.82,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {
                "evidence_tier": "confirmed_signal",
                "classification": "competitor",
            },
        },
        {
            "id": "77777777-7777-4777-8777-777777777777",
            "source_ref_id": "44444444-4444-4444-8444-444444444444",
            "kind": "market_context",
            "statement": "نتائج البحث تشير إلى طلب محلي على الحلويات للمناسبات في أسيوط.",
            "confidence": 0.74,
            "visibility": "internal",
            "status": "accepted",
            "metadata": {
                "evidence_tier": "likely_signal",
                "classification": "market_context",
            },
        },
        {
            "id": "88888888-8888-4888-8888-888888888888",
            "source_ref_id": "44444444-4444-4444-8444-444444444444",
            "kind": "market_context",
            "statement": "نتيجة ضعيفة غير مرتبطة بأسيوط.",
            "confidence": 0.21,
            "visibility": "internal",
            "status": "discarded",
            "discard_reason": "Wrong city.",
            "metadata": {"evidence_tier": "discarded"},
        },
    ]

    provider = CapturingArabicProvider()
    request = AiDiscoveryStartRequest.model_validate(payload)
    result = run(DiscoveryService(provider).start(request))

    assert result.action == "ask_next_question"
    assert result.next_question is not None
    assert "أكثر منتج" in result.next_question
    assert provider.last_request is not None
    context_pack = provider.last_request.payload["intelligence"]["research_context_pack"]
    assert [item["observation_id"] for item in context_pack["competitor_candidates"]] == [
        "66666666-6666-4666-8666-666666666666"
    ]
    assert [item["observation_id"] for item in context_pack["social_presence_signals"]] == [
        "55555555-5555-4555-8555-555555555555"
    ]
    assert [item["observation_id"] for item in context_pack["market_context_signals"]] == [
        "77777777-7777-4777-8777-777777777777"
    ]
    packed_ids = {
        item["observation_id"]
        for section in (
            "accepted_observations",
            "unconfirmed_findings",
            "competitor_candidates",
            "social_presence_signals",
            "market_context_signals",
        )
        for item in context_pack[section]
    }
    assert "88888888-8888-4888-8888-888888888888" not in packed_ids
    assert context_pack["source_quality_notes"][0] == {
        "source_ref_id": "22222222-2222-4222-8222-222222222222",
        "platform": "facebook",
        "provider": "facebook",
        "confidence": 0.45,
        "enrichment_status": None,
    }


def test_discarded_observation_requires_discard_reason() -> None:
    discarded = ResearchObservation(
        id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01",
        source_ref_id=None,
        kind="competitor",
        statement="Wrong business match — different location.",
        confidence=0.31,
        visibility="internal",
        status="discarded",
        discard_reason="Confidence 0.31 below 0.50 threshold. Matched wrong geographic location.",
        metadata={},
    )
    assert discarded.status == "discarded"
    assert discarded.discard_reason is not None
    assert len(discarded.discard_reason) > 0

    with pytest.raises(ValidationError, match="discard_reason is required"):
        ResearchObservation(
            id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02",
            source_ref_id=None,
            kind="competitor",
            statement="Wrong business match.",
            confidence=0.31,
            visibility="internal",
            status="discarded",
            metadata={},
        )


# ---------------------------------------------------------------------------
# Profile draft separation from confirmed profile
# ---------------------------------------------------------------------------

def test_profile_draft_separates_confirmed_facts_from_observations() -> None:
    payload = base_payload("en")
    payload["messages"] = [owner_message("Mostly office workers at lunch.")]
    request = AiDiscoverySummarizeRequest.model_validate(
        with_completion_context(payload)
    )
    result = run(DiscoveryService(MockDiscoveryProvider()).summarize(request))

    assert result.action == "produce_profile_draft"
    assert result.profile_draft is not None

    draft = result.profile_draft
    assert draft.confirmed_facts.identity.business_name == "Koshary Corner"
    assert draft.confirmed_facts.identity.city == "Cairo"
    assert draft.confirmed_facts.goals_and_constraints.growth_goals == [
        "Attract more lunch customers."
    ]
    assert isinstance(draft.market_context.competitor_landscape, list)
    assert isinstance(draft.research_observations, list)
    assert isinstance(draft.uncertainties, list)
    assert isinstance(draft.owner_goals, list)
    assert isinstance(draft.strategy_relevant_notes, list)

    owner_fact_keys = set(draft.confirmed_facts.model_dump())
    assert owner_fact_keys == {
        "identity",
        "offer",
        "customers",
        "differentiation",
        "current_marketing",
        "goals_and_constraints",
    }
    assert {uncertainty.domain for uncertainty in draft.uncertainties} == {
        "offer",
        "customers",
        "differentiation",
        "current_marketing",
        "goals_and_constraints",
    }
    assert all(not uncertainty.resolved for uncertainty in draft.uncertainties)
    assert draft.status == "ready_for_confirmation"


def test_profile_uncertainty_as_standalone_schema() -> None:
    uncertainty = Uncertainty(
        domain="goals_and_constraints",
        field_key="marketing_budget",
        description="Owner did not state a specific marketing budget.",
        severity="medium",
        category="owner_unknown",
        source="owner_unknown",
        owner_stated_value="Maybe something small to start",
        resolved=False,
    )
    assert uncertainty.field_key == "marketing_budget"
    assert uncertainty.severity == "medium"
    assert uncertainty.category == "owner_unknown"
    assert uncertainty.resolved is False
    assert uncertainty.description is not None


# ---------------------------------------------------------------------------
# Source tracking for owner answer vs research observation
# ---------------------------------------------------------------------------

def test_source_ref_has_all_required_fields() -> None:
    source = SourceRef(
        id="22222222-2222-4222-8222-222222222222",
        source_type="metadata",
        platform="instagram",
        url="https://www.instagram.com/kosharycorner.example",
        title="Koshary Corner",
        snippet="Egyptian comfort food in Nasr City",
        fetched_at="2026-06-25T10:00:05.000Z",
        confidence=0.86,
        metadata={"source_label": "Submitted Instagram metadata"},
    )
    assert source.id is not None
    assert source.source_type == "metadata"
    assert source.url is not None
    assert source.title is not None
    assert source.fetched_at is not None
    assert 0.0 <= source.confidence <= 1.0


def test_research_observation_has_source_ref_or_label() -> None:
    with_ref = ResearchObservation(
        id="44444444-4444-4444-8444-444444444444",
        source_ref_id="22222222-2222-4222-8222-222222222222",
        kind="digital_presence",
        statement="Instagram describes Koshary Corner as Egyptian comfort food.",
        confidence=0.86,
        visibility="owner_visible",
        status="accepted",
        metadata={"source_label": "Submitted Instagram metadata"},
    )
    assert with_ref.source_ref_id is not None

    with_label = ResearchObservation(
        id="99999999-9999-4999-8999-999999999999",
        source_ref_id=None,
        kind="metadata",
        statement="Google Maps 3.8 stars from 124 reviews.",
        confidence=0.72,
        visibility="owner_visible",
        status="accepted",
        metadata={"source_label": "Google Maps metadata extraction"},
    )
    assert with_label.metadata.get("source_label") is not None


def test_owner_visible_observation_requires_source() -> None:
    valid_owner_visible = ResearchObservation(
        id="44444444-4444-4444-8444-444444444444",
        source_ref_id="22222222-2222-4222-8222-222222222222",
        kind="digital_presence",
        statement="Instagram metadata extracted.",
        confidence=0.86,
        visibility="owner_visible",
        status="accepted",
        metadata={"source_label": "Instagram metadata"},
    )
    assert valid_owner_visible.source_ref_id is not None or "source_label" in valid_owner_visible.metadata

    with pytest.raises(
        ValidationError,
        match="owner-visible observations require",
    ):
        ResearchObservation(
            id="44444444-4444-4444-8444-444444444445",
            source_ref_id=None,
            kind="digital_presence",
            statement="Uncited owner-visible claim.",
            confidence=0.86,
            visibility="owner_visible",
            status="accepted",
            metadata={},
        )


# ---------------------------------------------------------------------------
# Schema validation cases
# ---------------------------------------------------------------------------

def test_invalid_action_rejected_by_schema() -> None:
    try:
        DiscoveryModelOutput(
            action="invalid_action",
            ready_to_summarize=False,
            updated_known_facts={},
            updated_uncertainties=[],
            domain_scores={},
        )
    except ValidationError:
        pass
    else:
        msg = "Invalid action should raise ValidationError"
        raise AssertionError(msg)


def test_question_action_requires_next_question() -> None:
    try:
        DiscoveryModelOutput(
            action="ask_next_question",
            ready_to_summarize=False,
            next_question=None,
            updated_known_facts={},
            updated_uncertainties=[],
            domain_scores={},
        )
    except ValidationError:
        pass
    else:
        msg = "ask_next_question without next_question should raise ValidationError"
        raise AssertionError(msg)


def test_discovery_model_output_action_validation() -> None:
    valid = DiscoveryModelOutput(
        action="ask_next_question",
        ready_to_summarize=False,
        next_question="What is your best-selling item?",
        updated_known_facts={},
        updated_uncertainties=[],
        domain_scores={},
    )
    assert valid.action == "ask_next_question"

    draft_action = DiscoveryModelOutput(
        action="produce_profile_draft",
        ready_to_summarize=True,
        updated_known_facts={},
        updated_uncertainties=[],
        domain_scores={},
    )
    assert draft_action.action == "produce_profile_draft"


def test_profile_draft_jsonb_fields_are_valid() -> None:
    payload = base_payload("en")
    payload["messages"] = [owner_message("Mostly office workers at lunch.")]
    request = AiDiscoverySummarizeRequest.model_validate(
        with_completion_context(payload)
    )
    result = run(DiscoveryService(MockDiscoveryProvider()).summarize(request))

    assert result.profile_draft is not None
    draft_dict = result.profile_draft.model_dump(mode="json")

    assert isinstance(draft_dict["confirmed_facts"], dict)
    assert isinstance(draft_dict["research_observations"], list)
    assert isinstance(draft_dict["uncertainties"], list)
    assert isinstance(draft_dict["owner_goals"], list)
    assert isinstance(draft_dict["strategy_relevant_notes"], list)
    assert isinstance(draft_dict["raw_ai_output"], dict)


# ---------------------------------------------------------------------------
# Confirmation boundary
# ---------------------------------------------------------------------------

def test_strategy_locked_before_confirmation() -> None:
    payload = base_payload("en")
    payload["messages"] = [owner_message("Mostly office workers at lunch.")]
    request = AiDiscoverySummarizeRequest.model_validate(
        with_completion_context(payload)
    )
    result = run(DiscoveryService(MockDiscoveryProvider()).summarize(request))

    assert result.profile_draft is not None
    assert result.profile_draft.status in ("draft", "ready_for_confirmation")

    draft = result.profile_draft
    assert draft.strategy_relevant_notes is not None
    assert any("locked" in note.lower() for note in draft.strategy_relevant_notes)


# ---------------------------------------------------------------------------
# HTTP endpoint cases
# ---------------------------------------------------------------------------

def test_internal_start_endpoint_with_arabic() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_provider_mode="mock")
    client = TestClient(app)
    payload = base_payload("ar-EG", with_gap=True)
    response = client.post("/internal/v1/ai/discovery/start", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["action"] == "ask_next_question"
    assert body["next_question"] is not None
    app.dependency_overrides.clear()


def test_internal_respond_endpoint_accepts_chat() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_provider_mode="mock")
    client = TestClient(app)
    payload = base_payload("en")
    payload["messages"] = [assistant_message("Who are your best customers?")]
    payload["owner_message"] = owner_message("Office workers at lunch.")
    response = client.post("/internal/v1/ai/discovery/respond", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["action"] in ("ask_next_question", "ask_clarification", "produce_profile_draft")
    app.dependency_overrides.clear()


def test_internal_summarize_endpoint_produces_draft() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(ai_provider_mode="mock")
    client = TestClient(app)
    payload = base_payload("en")
    payload["messages"] = [owner_message("Office workers at lunch.")]
    response = client.post(
        "/internal/v1/ai/discovery/summarize",
        json=with_completion_context(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["action"] == "produce_profile_draft"
    assert body["profile_draft"] is not None
    app.dependency_overrides.clear()
    assert body["profile_draft"]["status"] == "ready_for_confirmation"


# ---------------------------------------------------------------------------
# Relationship between owner answer and research observation
# ---------------------------------------------------------------------------

def test_owner_answer_tracked_separately_from_research() -> None:
    intake = PreparedDiscoveryIntake(
        business_name="Koshary Corner",
        business_type="quick service restaurant",
        city="Cairo",
        area="Nasr City",
    )
    assert intake.business_name == "Koshary Corner"

    source = SourceRef(
        id="22222222-2222-4222-8222-222222222222",
        source_type="metadata",
        platform="instagram",
        url="https://www.instagram.com/kosharycorner.example",
        title="Koshary Corner",
        snippet="Egyptian comfort food in Nasr City",
        fetched_at="2026-06-25T10:00:05.000Z",
        confidence=0.86,
        metadata={"source_label": "Instagram metadata"},
    )
    assert source.source_type == "metadata"

    observation = ResearchObservation(
        id="44444444-4444-4444-8444-444444444444",
        source_ref_id=source.id,
        kind="digital_presence",
        statement="Instagram describes Koshary Corner as Egyptian comfort food.",
        confidence=0.86,
        visibility="owner_visible",
        status="accepted",
        metadata={"source_label": "Instagram metadata"},
    )
    assert observation.statement != intake.business_name


def test_profile_groups_only_cited_research_into_market_context() -> None:
    payload = base_payload("en")
    payload["messages"] = [owner_message("Office workers usually order at lunch.")]
    payload["intelligence"]["source_refs"] = [
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "source_type": "search_result",
            "platform": "serpapi",
            "url": "https://example.com/nearby-cafe",
            "confidence": 0.82,
            "metadata": {},
        }
    ]
    payload["intelligence"]["research_observations"] = [
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "source_ref_id": "22222222-2222-4222-8222-222222222222",
            "kind": "competitor",
            "statement": "A nearby quick-service restaurant appears in local search.",
            "confidence": 0.82,
            "visibility": "owner_visible",
            "status": "accepted",
            "metadata": {},
        },
        {
            "id": "55555555-5555-4555-8555-555555555555",
            "kind": "market_context",
            "statement": "An uncited market assumption.",
            "confidence": 0.4,
            "visibility": "internal",
            "status": "accepted",
            "metadata": {},
        },
    ]
    request = AiDiscoverySummarizeRequest.model_validate(
        with_completion_context(payload)
    )

    result = run(DiscoveryService(MockDiscoveryProvider()).summarize(request))

    assert result.profile_draft is not None
    context = result.profile_draft.market_context
    assert [item.observation_id for item in context.competitor_landscape] == [
        "44444444-4444-4444-8444-444444444444"
    ]
    assert context.local_demand_signals == []
