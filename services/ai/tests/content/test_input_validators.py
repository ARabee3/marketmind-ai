"""Phase 1 tests for deterministic Content generation input checks."""

import pytest

from content_contracts import AiContentGenerateRequest, ContentWeekContext

from app.content.validators import validate_content_generation_request
from tests.content.fixture_helpers import make_valid_request


@pytest.fixture
def valid_request() -> AiContentGenerateRequest:
    return make_valid_request()


def _codes(result) -> set[str]:
    return {issue.code for issue in result.issues}


def test_valid_request_passes(valid_request: AiContentGenerateRequest) -> None:
    result = validate_content_generation_request(valid_request)

    assert result.valid
    assert result.issues == []


@pytest.mark.parametrize(
    ("mutation", "expected_code"),
    [
        ("strategy_identity", "CONTENT_VERSION_CONFLICT"),
        ("profile_version", "CONTENT_PROFILE_STALE"),
        ("language", "CONTENT_SCHEMA_FAILURE"),
        ("channel", "CONTENT_CHANNEL_MISMATCH"),
        ("week", "CONTENT_WEEK_OUT_OF_RANGE"),
        ("formats", "CONTENT_SCHEMA_FAILURE"),
    ],
)
def test_invalid_grounding_snapshot_returns_stable_code(
    valid_request: AiContentGenerateRequest,
    mutation: str,
    expected_code: str,
) -> None:
    request = valid_request.model_copy(deep=True)

    if mutation == "strategy_identity":
        request = request.model_copy(update={"strategy_version": 2})
    elif mutation == "profile_version":
        profile = request.business_profile.model_copy(update={"version": 2})
        request = request.model_copy(update={"business_profile": profile})
    elif mutation == "language":
        request = request.model_copy(update={"language_mode": "en"})
    elif mutation == "channel":
        request = request.model_copy(update={"selected_channels": ["facebook"]})
    elif mutation == "week":
        context = request.week_context.model_copy(update={"week_number": 13})
        request = request.model_copy(update={"week_context": context})
    elif mutation == "formats":
        request = request.model_copy(update={"allowed_formats": []})

    result = validate_content_generation_request(request)

    assert not result.valid
    assert expected_code in _codes(result)


def test_system_defaulted_context_cannot_carry_promotion(
    valid_request: AiContentGenerateRequest,
) -> None:
    context_data = valid_request.week_context.model_dump(mode="python")
    context_data["context_source"] = "system_defaulted"
    context_data["confirmed_by_user_id"] = None
    context_data["confirmed_at"] = None
    context_data["system_defaulted_at"] = valid_request.week_context.generation_cutoff_at
    context_data["promotion_mode"] = "none"
    context = ContentWeekContext.model_construct(**context_data)
    request = valid_request.model_copy(update={"week_context": context})

    result = validate_content_generation_request(request)

    assert not result.valid
    assert "CONTENT_POLICY_VIOLATION" in _codes(result)


def test_owner_instructions_cannot_require_and_forbid_the_same_text(
    valid_request: AiContentGenerateRequest,
) -> None:
    context = valid_request.week_context.model_copy(
        update={
            "must_include": ["اذكر خدمة التوصيل"],
            "must_avoid": ["  اذكر خدمة التوصيل  "],
        }
    )
    request = valid_request.model_copy(update={"week_context": context})

    result = validate_content_generation_request(request)

    assert not result.valid
    assert "CONTENT_POLICY_VIOLATION" in _codes(result)
