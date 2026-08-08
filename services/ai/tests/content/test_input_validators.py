"""Phase 1 tests for deterministic Content generation input checks."""

import pytest

from content_contracts import AiContentGenerateRequest, ContentWeekContext
from strategy_contracts import BusinessProfilePayload

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


# ---------------------------------------------------------------------------
# Owner-first strategy-v2 strategy_plan in the content-v1 envelope (issue #135)
# ---------------------------------------------------------------------------


def make_valid_v2_request() -> AiContentGenerateRequest:
    """Content generation request grounded in an approved strategy-v2 plan."""
    from strategy_contracts import StrategyPlanV2
    from tests.content.fixture_helpers import load_example

    strategy = StrategyPlanV2.model_validate(
        load_example("strategy-plan-v2.example.json")
    )
    context = ContentWeekContext.model_validate(
        load_example("content-week-context-safe-default.example.json")
    )
    profile = BusinessProfilePayload(
        id=strategy.profile_version.business_profile_version_id,
        business_id="11111111-1111-4111-8111-111111111111",
        version=strategy.profile_version.version,
        profile={"business_name": "Koshary Corner"},
        confirmed_by_user_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        confirmed_at=strategy.profile_version.confirmed_at,
        created_at=strategy.profile_version.confirmed_at,
    )
    handoff = strategy.content_handoff
    assert handoff.available is True
    return AiContentGenerateRequest(
        contract_version="content-v1",
        content_pack_id="77777777-7777-4777-8777-777777777777",
        business_id=profile.business_id,
        strategy_id=strategy.strategy_id,
        strategy_version=strategy.version,
        strategy_decision_id="55555555-5555-4555-8555-555555555555",
        strategy_plan=strategy,
        business_profile=profile,
        week_context=context,
        selected_channels=handoff.channels,
        allowed_formats=[
            format
            for week in handoff.weeks
            if week.week_number == context.week_number
            for format in week.formats
        ],
        language_mode=strategy.plan_language.value,
    )


def test_v2_plan_grounded_request_passes() -> None:
    request = make_valid_v2_request()
    result = validate_content_generation_request(request)
    assert result.valid
    assert result.issues == []


def test_v2_plan_rejects_channel_outside_handoff() -> None:
    request = make_valid_v2_request()
    request = request.model_copy(update={"selected_channels": ["tiktok"]})
    result = validate_content_generation_request(request)
    assert not result.valid
    assert "CONTENT_CHANNEL_MISMATCH" in _codes(result)


def test_v2_plan_rejects_week_outside_handoff() -> None:
    # The handoff covers all twelve weeks, so only an out-of-range week fails.
    request = make_valid_v2_request()
    context = request.week_context.model_copy(update={"week_number": 13})
    request = request.model_copy(update={"week_context": context})
    result = validate_content_generation_request(request)
    assert not result.valid
    assert "CONTENT_WEEK_OUT_OF_RANGE" in _codes(result)


def test_v2_plan_accepts_every_handoff_week() -> None:
    for week_number in range(1, 13):
        request = make_valid_v2_request()
        context = request.week_context.model_copy(update={"week_number": week_number})
        request = request.model_copy(update={"week_context": context})
        result = validate_content_generation_request(request)
        assert result.valid, f"week {week_number} failed: {result.issues}"
