"""Comprehensive deterministic provider-fake and contract mutation matrix."""

from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from content_contracts import (
    ContentClaimSource,
    ContentItemVersion,
    ContentWeekContext,
    validate_content_policy_fixture,
)

from app.content.assembler import assemble_generation_prompt
from app.content.service import generate_content_pack_with_repair
from app.content.validators import validate_generated_content_pack
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider, MockContentProvider
from tests.content.fixture_helpers import load_example, make_valid_request


def _text_request():
    return make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})


def _generate(request):
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    return asyncio.run(MockContentProvider().generate_content_pack(prompt))


@pytest.mark.parametrize("content_format", ["text_post", "short_video_script"])
def test_provider_fake_covers_non_media_and_script_formats(content_format: str) -> None:
    request = make_valid_request().model_copy(update={"allowed_formats": [content_format]})
    items = _generate(request)

    assert len(items) == 3
    assert all(item.format == content_format for item in items)
    if content_format == "short_video_script":
        assert all(item.short_video_script is not None for item in items)
    result = validate_generated_content_pack(request, items)
    assert result.valid


@pytest.mark.parametrize(
    ("claim_type", "expected_code"),
    [
        ("price", "CONTENT_UNSUPPORTED_CLAIM"),
        ("availability", "CONTENT_UNSUPPORTED_CLAIM"),
        ("superiority", "CONTENT_UNSUPPORTED_CLAIM"),
        ("testimonial", "CONTENT_UNSUPPORTED_CLAIM"),
        ("competitor_comparison", "CONTENT_UNSUPPORTED_CLAIM"),
        ("guarantee", "CONTENT_POLICY_VIOLATION"),
        ("regulated", "CONTENT_POLICY_VIOLATION"),
        ("branded_sponsored", "CONTENT_POLICY_VIOLATION"),
    ],
)
def test_provider_output_blocks_every_unsafe_claim_class(
    claim_type: str,
    expected_code: str,
) -> None:
    request = _text_request()
    items = _generate(request)
    unsafe_claim = ContentClaimSource(
        claim_type=claim_type,
        source_type="strategy",
        source_path="strategy_plan.untrusted_claim",
        approved=False,
    )
    items[0] = items[0].model_copy(
        update={"claim_sources": [*items[0].claim_sources, unsafe_claim]}
    )

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert expected_code in {issue.code for issue in result.issues}


def test_expired_promotion_is_rejected() -> None:
    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    items = _generate(request)
    promotion = request.week_context.promotion
    assert promotion is not None
    expired = promotion.model_copy(
        update={"valid_until": datetime(2020, 1, 1, tzinfo=timezone.utc)}
    )
    context = request.week_context.model_copy(update={"promotion": expired})
    request = request.model_copy(update={"week_context": context})

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert "CONTENT_OFFER_UNAPPROVED" in {issue.code for issue in result.issues}


def test_defaulted_no_promotion_context_rejects_promotion_claim() -> None:
    request = _text_request()
    items = _generate(request)
    context_data = request.week_context.model_dump(mode="python")
    context_data.update(
        {
            "promotion_mode": "none",
            "promotion": None,
            "context_source": "system_defaulted",
            "confirmed_by_user_id": None,
            "confirmed_at": None,
            "system_defaulted_at": request.week_context.generation_cutoff_at,
        }
    )
    context = ContentWeekContext.model_construct(**context_data)
    request = request.model_copy(update={"week_context": context})
    claim = ContentClaimSource(
        claim_type="promotion",
        source_type="week_context",
        source_path="week_context.promotion",
        approved=True,
    )
    items[0] = items[0].model_copy(
        update={"claim_sources": [*items[0].claim_sources, claim]}
    )

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert "CONTENT_OFFER_UNAPPROVED" in {issue.code for issue in result.issues}


def test_schema_boundaries_reject_invalid_item_and_pack_sizes() -> None:
    request = _text_request()
    items = _generate(request)

    too_few = validate_generated_content_pack(request, items[:2])
    too_many = validate_generated_content_pack(request, [*items, items[0], items[1], items[2]])

    assert "CONTENT_SCHEMA_FAILURE" in {issue.code for issue in too_few.issues}
    assert "CONTENT_SCHEMA_FAILURE" in {issue.code for issue in too_many.issues}

    invalid_data = items[0].model_dump(mode="json")
    invalid_data["alt_text"] = "ا" * 101
    with pytest.raises(ValidationError):
        ContentItemVersion.model_validate(invalid_data)


class TimeoutThenValidProvider(ContentLLMProvider):
    name = "timeout-fake"

    def __init__(self, valid_items):
        self.valid_items = valid_items
        self.calls = 0

    async def generate_content_pack(self, prompt):
        self.calls += 1
        if self.calls == 1:
            raise ProviderError("CONTENT_PROVIDER_FAILURE", "timeout", retryable=True)
        return self.valid_items

    async def revise_content_item(self, prompt):
        raise NotImplementedError


@pytest.mark.asyncio
async def test_provider_timeout_has_bounded_retry() -> None:
    request = _text_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    provider = TimeoutThenValidProvider(valid_items)

    async def no_sleep(_: float) -> None:
        return None

    result = await generate_content_pack_with_repair(
        provider,
        prompt,
        sleep=no_sleep,
    )

    assert len(result) == 3
    assert provider.calls == 2


def _policy_fixture() -> dict:
    return load_example("content-pack-week-1-ar.example.json")


@pytest.mark.parametrize(
    ("mutation", "expected_code"),
    [
        ("strategy_status", "CONTENT_STRATEGY_NOT_APPROVED"),
        ("profile_version", "CONTENT_PROFILE_STALE"),
        ("cycle_status", "CONTENT_CYCLE_PAUSED"),
        ("wrong_channel", "CONTENT_CHANNEL_MISMATCH"),
        ("expired_promotion", "CONTENT_OFFER_UNAPPROVED"),
        ("missing_asset", "CONTENT_ASSET_REQUIRED"),
        ("protected_text", "CONTENT_POLICY_VIOLATION"),
    ],
)
def test_frozen_fixture_mutations_keep_stable_policy_codes(
    mutation: str,
    expected_code: str,
) -> None:
    fixture = copy.deepcopy(_policy_fixture())
    if mutation == "strategy_status":
        fixture["strategy_status"] = "draft"
    elif mutation == "profile_version":
        fixture["current_profile_version_id"] = "00000000-0000-4000-8000-000000000000"
    elif mutation == "cycle_status":
        fixture["cycle_status"] = "paused"
    elif mutation == "wrong_channel":
        fixture["item_version"]["channel"] = "instagram"
    elif mutation == "expired_promotion":
        fixture["week_context"]["promotion"]["valid_until"] = "2020-01-01T00:00:00+00:00"
    elif mutation == "missing_asset":
        fixture["assets"][0]["status"] = "missing"
    elif mutation == "protected_text":
        fixture["protected_text_mutated"] = True

    result = validate_content_policy_fixture(fixture)

    assert not result.valid
    assert expected_code in {issue.code for issue in result.issues}
