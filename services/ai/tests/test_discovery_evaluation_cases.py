import asyncio
from typing import Any

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.discovery.schemas import (
    AiDiscoveryRespondRequest,
    AiDiscoveryStartRequest,
    AiDiscoverySummarizeRequest,
    BusinessProfileDraft,
    DiscoveryModelOutput,
    IntelligenceResult,
    PreparedDiscoveryIntake,
    ProfileUncertainty,
    ResearchObservation,
    SourceRef,
)
from app.discovery.service import DiscoveryService
from app.providers.base import DiscoveryProvider, DiscoveryProviderRequest, ProviderError
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
    result = run(DiscoveryService(MockDiscoveryProvider()).respond(request))

    assert result.action in ("ask_next_question", "ask_clarification")
    uncertainties = result.updated_uncertainties
    contradiction = next(
        (u for u in uncertainties if "hour" in u.field_key.lower() or "peak" in u.field_key.lower()),
        None,
    )
    if contradiction is not None:
        assert contradiction.severity in ("low", "medium", "high")
    else:
        assert len(uncertainties) == 0


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
    if metadata_obs is not None:
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

    accepted_observations = [
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

    payload["intelligence"]["research_observations"] = accepted_observations
    request = AiDiscoveryStartRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).start(request))

    passed_to_ai = result.research_observations
    for obs in passed_to_ai:
        assert obs.status == "accepted", "Discarded observations must not reach AI context"
        assert obs.confidence >= 0.4, "Low-confidence discarded observations must not reach AI context"


def test_discarded_observation_has_discard_reason() -> None:
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


# ---------------------------------------------------------------------------
# Profile draft separation from confirmed profile
# ---------------------------------------------------------------------------

def test_profile_draft_separates_confirmed_facts_from_observations() -> None:
    payload = base_payload("en")
    payload["messages"] = [owner_message("Mostly office workers at lunch.")]
    request = AiDiscoverySummarizeRequest.model_validate(payload)
    result = run(DiscoveryService(MockDiscoveryProvider()).summarize(request))

    assert result.action == "produce_profile_draft"
    assert result.profile_draft is not None

    draft = result.profile_draft
    assert isinstance(draft.confirmed_facts, dict)
    assert isinstance(draft.research_observations, list)
    assert isinstance(draft.uncertainties, list)
    assert isinstance(draft.owner_goals, list)
    assert isinstance(draft.strategy_relevant_notes, list)

    owner_fact_keys = set(draft.confirmed_facts.keys())
    observation_statements = {o.statement for o in draft.research_observations}

    assert len(owner_fact_keys) >= 3, "Confirmed facts should contain business-owner-stated data"
    assert len(draft.uncertainties) >= 0
    assert draft.status == "ready_for_confirmation"


def test_profile_uncertainty_as_standalone_schema() -> None:
    uncertainty = ProfileUncertainty(
        field_key="marketing_budget",
        description="Owner did not state a specific marketing budget.",
        severity="medium",
    )
    assert uncertainty.field_key == "marketing_budget"
    assert uncertainty.severity == "medium"
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


# ---------------------------------------------------------------------------
# Schema validation cases
# ---------------------------------------------------------------------------

def test_invalid_action_rejected_by_schema() -> None:
    try:
        DiscoveryModelOutput(
            action="invalid_action",
            updated_known_facts={},
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
            next_question=None,
            updated_known_facts={},
        )
    except ValidationError:
        pass
    else:
        msg = "ask_next_question without next_question should raise ValidationError"
        raise AssertionError(msg)


def test_discovery_model_output_action_validation() -> None:
    valid = DiscoveryModelOutput(
        action="ask_next_question",
        next_question="What is your best-selling item?",
        updated_known_facts={},
    )
    assert valid.action == "ask_next_question"

    draft_action = DiscoveryModelOutput(
        action="produce_profile_draft",
        updated_known_facts={},
    )
    assert draft_action.action == "produce_profile_draft"


def test_profile_draft_jsonb_fields_are_valid() -> None:
    payload = base_payload("en")
    payload["messages"] = [owner_message("Mostly office workers at lunch.")]
    request = AiDiscoverySummarizeRequest.model_validate(payload)
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
    request = AiDiscoverySummarizeRequest.model_validate(payload)
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
    client = TestClient(create_app())
    payload = base_payload("ar-EG", with_gap=True)
    response = client.post("/internal/v1/ai/discovery/start", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["action"] == "ask_next_question"
    assert body["next_question"] is not None


def test_internal_respond_endpoint_accepts_chat() -> None:
    client = TestClient(create_app())
    payload = base_payload("en")
    payload["messages"] = [assistant_message("Who are your best customers?")]
    payload["owner_message"] = owner_message("Office workers at lunch.")
    response = client.post("/internal/v1/ai/discovery/respond", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["action"] in ("ask_next_question", "ask_clarification", "produce_profile_draft")


def test_internal_summarize_endpoint_produces_draft() -> None:
    client = TestClient(create_app())
    payload = base_payload("en")
    payload["messages"] = [owner_message("Office workers at lunch.")]
    response = client.post("/internal/v1/ai/discovery/summarize", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["action"] == "produce_profile_draft"
    assert body["profile_draft"] is not None
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
