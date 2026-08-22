"""Planner-stage tests (Content v2, issue #187)."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from content_v2_contracts import (
    AiContentV2PlanRequest,
    AiContentV2PlanResponse,
    CONTENT_V2_MAX_POSTS,
    CONTENT_V2_MIN_POSTS,
    ContentPostPlanDraftV2,
)

from app.content.circuit_breaker import CircuitBreaker
from app.content.planner import (
    assemble_plan_prompt,
    plan_content_week_with_repair,
)
from app.content.planner_validators import (
    validate_content_plan_request,
    validate_generated_plan,
)
from app.core.config import Settings
from app.providers.base import ProviderError
from app.providers.content_provider import (
    ContentLLMProvider,
    ContentPlanProviderOutput,
    MockContentProvider,
)
from tests.content.fixture_helpers import make_valid_plan_request


def _plans_from_request(
    request: AiContentV2PlanRequest,
    *,
    count: int = 3,
) -> list[ContentPostPlanDraftV2]:
    channels = request.allowed_channels
    formats = request.allowed_formats
    cta_ids = [entry.id for entry in request.cta_library]
    media_ids = [entry.id for entry in request.media_library]
    return [
        ContentPostPlanDraftV2(
            purpose=f"Card {index + 1} for week {request.week_number}",
            intended_audience="nearby office workers",
            channel=channels[index % len(channels)],
            format=formats[index % len(formats)],
            cta_library_entry_id=(cta_ids[0] if index == 0 and cta_ids else None),
            owner_instructions=None,
            visual_direction=None,
            selected_media_ids=([media_ids[0]] if index == 0 and media_ids else []),
        )
        for index in range(count)
    ]


class SequencePlannerProvider(ContentLLMProvider):
    """Provider that replays fixed plan outputs (first invalid, then valid)."""

    name = "sequence"

    def __init__(self, outputs: list[list[ContentPostPlanDraftV2]]) -> None:
        self.outputs = outputs

    async def generate_content_plan(
        self,
        prompt: object,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentPostPlanDraftV2]:
        if not self.outputs:
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE", "no more outputs", retryable=True
            )
        return self.outputs.pop(0)

    async def generate_content_pack(
        self,
        prompt: object,
        *,
        max_output_tokens: int | None = None,
    ) -> list[object]:
        raise NotImplementedError

    async def revise_content_item(self, prompt: object) -> object:
        raise NotImplementedError


def test_assemble_plan_prompt_valid_request() -> None:
    request = make_valid_plan_request()
    prompt = assemble_plan_prompt(request, "mock", "mock-content-model")
    assert prompt.metadata["week_number"] == 1
    assert prompt.metadata["contract_version"] == "content-v2"
    assert prompt.context["plan_identity"]["week_plan_id"] == request.week_plan_id
    assert prompt.context["grounding_inputs"]["allowed_channels"] == request.allowed_channels


def test_plan_prompt_never_allows_fewer_than_three_cards() -> None:
    request = make_valid_plan_request()
    prompt = assemble_plan_prompt(request, "mock", "mock-content-model")

    assert "Always return 3-5 cards" in prompt.system_prompt
    assert "return fewer cards" not in prompt.system_prompt


def test_plan_provider_schema_enforces_card_count() -> None:
    request = make_valid_plan_request()
    post_plans_schema = ContentPlanProviderOutput.model_json_schema()["properties"][
        "post_plans"
    ]

    assert post_plans_schema["minItems"] == CONTENT_V2_MIN_POSTS
    assert post_plans_schema["maxItems"] == CONTENT_V2_MAX_POSTS
    with pytest.raises(ValidationError):
        ContentPlanProviderOutput(post_plans=_plans_from_request(request, count=2))


def test_assemble_plan_prompt_requires_editorial_voice() -> None:
    payload = make_valid_plan_request().model_dump(mode="json")
    # Whitespace-only voice passes the contract's min_length but fails the
    # planner grounding gate.
    payload["editorial_profile"]["voice"] = "   "
    request = AiContentV2PlanRequest.model_validate(payload)
    with pytest.raises(ValueError, match="CONTENT_SCHEMA_FAILURE"):
        assemble_plan_prompt(request, "mock", "mock-content-model")


def test_plan_validator_rejects_non_v2_strategy() -> None:
    request = make_valid_plan_request()
    # model_construct bypasses the Literal so the validator gate is testable.
    raw = request.model_dump(mode="json")
    raw["strategy_plan"]["contract_version"] = "strategy-v1"
    raw["strategy_plan"] = _StubPlanV1(raw["strategy_plan"])
    result = validate_content_plan_request(_StubRequest(raw, request))
    assert result.valid is False
    assert result.issues[0].code == "CONTENT_SCHEMA_FAILURE"


def test_validate_generated_plan_rejects_disallowed_channel() -> None:
    request = make_valid_plan_request()
    plans = _plans_from_request(request)
    plans[0] = plans[0].model_dump(mode="json")
    plans[0]["channel"] = "tiktok"
    plans[0] = ContentPostPlanDraftV2.model_validate(plans[0])
    if "tiktok" in request.allowed_channels:
        pytest.skip("tiktok is allowed in this fixture")
    result = validate_generated_plan(request, plans)
    assert result.valid is False
    assert any(
        issue.code == "CONTENT_CHANNEL_MISMATCH" for issue in result.issues
    )


def test_validate_generated_plan_rejects_unknown_cta() -> None:
    request = make_valid_plan_request()
    plans = _plans_from_request(request)
    plans[1] = plans[1].model_dump(mode="json")
    plans[1]["cta_library_entry_id"] = "00000000-0000-4000-8000-000000000000"
    plans[1] = ContentPostPlanDraftV2.model_validate(plans[1])
    result = validate_generated_plan(request, plans)
    assert result.valid is False


def test_validate_generated_plan_rejects_unknown_media() -> None:
    request = make_valid_plan_request()
    plans = _plans_from_request(request)
    plans[2] = plans[2].model_dump(mode="json")
    plans[2]["selected_media_ids"] = ["00000000-0000-4000-8000-000000000000"]
    plans[2] = ContentPostPlanDraftV2.model_validate(plans[2])
    result = validate_generated_plan(request, plans)
    assert result.valid is False


def test_validate_generated_plan_accepts_valid_cards() -> None:
    request = make_valid_plan_request()
    result = validate_generated_plan(request, _plans_from_request(request))
    assert result.valid is True


def test_plan_repair_loop_recovers_after_invalid_first_output() -> None:
    request = make_valid_plan_request()
    bad = _plans_from_request(request, count=2)
    good = _plans_from_request(request, count=3)
    provider = SequencePlannerProvider([bad, good])
    prompt = assemble_plan_prompt(request, "sequence", "sequence-model")

    plans = asyncio.run(
        plan_content_week_with_repair(provider, prompt, request, breaker=None)
    )

    assert len(plans) == 3


def test_plan_repair_loop_never_exceeds_max_attempts() -> None:
    request = make_valid_plan_request()
    bad = _plans_from_request(request, count=2)
    provider = SequencePlannerProvider([bad, bad, bad])
    prompt = assemble_plan_prompt(request, "sequence", "sequence-model")

    with pytest.raises(ProviderError) as error:
        asyncio.run(
            plan_content_week_with_repair(provider, prompt, request, breaker=None)
        )
    assert error.value.code == "CONTENT_SCHEMA_FAILURE"


def test_plan_schema_failures_do_not_open_provider_breaker() -> None:
    request = make_valid_plan_request()
    bad = _plans_from_request(request, count=2)
    provider = SequencePlannerProvider([bad, bad, bad])
    prompt = assemble_plan_prompt(request, "sequence", "sequence-model")
    breaker = CircuitBreaker(failure_threshold=1)

    with pytest.raises(ProviderError) as error:
        asyncio.run(
            plan_content_week_with_repair(provider, prompt, request, breaker=breaker)
        )

    assert error.value.code == "CONTENT_SCHEMA_FAILURE"
    assert breaker.failures == 0
    assert breaker.allow()


def test_plan_retryable_provider_failure_opens_breaker() -> None:
    request = make_valid_plan_request()
    provider = SequencePlannerProvider([])
    prompt = assemble_plan_prompt(request, "sequence", "sequence-model")
    breaker = CircuitBreaker(failure_threshold=1)

    with pytest.raises(ProviderError) as error:
        asyncio.run(
            plan_content_week_with_repair(provider, prompt, request, breaker=breaker)
        )

    assert error.value.code == "CONTENT_PROVIDER_FAILURE"
    assert breaker.failures == 1
    assert not breaker.allow()


def test_mock_provider_returns_three_grounded_cards() -> None:
    request = make_valid_plan_request()
    provider = MockContentProvider()
    prompt = assemble_plan_prompt(request, "mock", "mock-content-model")

    plans = asyncio.run(provider.generate_content_plan(prompt))

    assert len(plans) == 3
    assert {plan.channel for plan in plans} <= set(request.allowed_channels)
    assert {plan.format for plan in plans} <= set(request.allowed_formats)
    assert all(plan.purpose for plan in plans)
    first = plans[0]
    assert first.cta_library_entry_id is not None
    assert first.selected_media_ids == [request.media_library[0].id]


def test_plan_endpoint_returns_plan_response() -> None:
    from app.core.config import get_settings
    from app.main import app as fastapi_app

    def _settings() -> Settings:
        return Settings(
            ai_provider_mode="mock",
            image_provider_mode="mock",
            content_asset_storage_dir="/tmp/content-assets-test",
        )

    client = TestClient(fastapi_app)
    fastapi_app.dependency_overrides[get_settings] = _settings
    request = make_valid_plan_request()
    try:
        response = client.post(
            "/internal/v1/ai/content/v2/plan",
            json=request.model_dump(mode="json"),
        )
    finally:
        fastapi_app.dependency_overrides.pop(get_settings, None)
    assert response.status_code == 200, response.text
    body = AiContentV2PlanResponse.model_validate(response.json())
    assert body.contract_version == "content-v2"
    assert body.week_plan_id == request.week_plan_id
    assert 3 <= len(body.post_plans) <= 5


class _StubPlanV1:
    """Minimal non-pydantic strategy stand-in carrying contract_version."""

    def __init__(self, data: dict) -> None:
        self.contract_version = data["contract_version"]


class _StubRequest:
    """Validation-only stand-in so validator gates are unit-testable."""

    def __init__(self, raw: dict, original: AiContentV2PlanRequest) -> None:
        self.raw = raw
        self.original = original

    @property
    def strategy_plan(self) -> _StubPlanV1:
        return self.raw["strategy_plan"]

    @property
    def allowed_channels(self) -> list[str]:
        return self.original.allowed_channels

    @property
    def allowed_formats(self) -> list[str]:
        return self.original.allowed_formats

    @property
    def editorial_profile(self) -> object:
        return self.original.editorial_profile

    @property
    def contract_version(self) -> str:
        return self.original.contract_version
