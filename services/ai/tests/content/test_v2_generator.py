"""Content v2 full-draft generation tests (frozen-input handoff, issue #187)."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from content_contracts import ContentClaimSource, ContentItemVersion
from content_v2_contracts import (
    AiContentV2GenerateResponse,
    AiContentV2ReviseRequest,
    AiContentV2ReviseResponse,
)

from app.content.v2_generator import (
    _normalize_v2_finalized_items,
    generate_v2_content_pack,
    v2_generate_to_v1_request,
    assemble_v2_generation_prompt,
    validate_plan_alignment,
    revise_v2_content_item,
    to_v1_item_version,
    to_v2_item_version,
)
from app.content.validators import compute_content_item_checksum
from app.core.config import Settings, get_settings
from app.main import app
from app.providers.content_provider import MockContentProvider
from tests.content.fixture_helpers import (
    make_valid_generate_v2_request,
    make_valid_plan_request,
)


def test_v2_generate_projects_frozen_snapshot_into_v1_request() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)

    assert v1.contract_version == "content-v1"
    assert v1.week_context.week_number == request.frozen_input.week_number
    assert v1.week_context.weekly_claim_id == request.frozen_input.weekly_claim_id
    assert v1.week_context.promotion_mode == "none"
    assert v1.week_context.must_include == []
    # Referenced media survive the approved-asset filter.
    plan_media = {
        media_id
        for plan in request.frozen_input.post_plans
        for media_id in plan.selected_media_ids
    }
    assert set(v1.week_context.approved_asset_ids) == plan_media
    assert set(v1.selected_channels) == {
        plan.channel for plan in request.frozen_input.post_plans
    }


def test_v2_generate_prompt_embeds_frozen_post_plans() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")

    assert "Frozen post-plan alignment" in prompt.system_prompt
    assert len(prompt.context["grounding_inputs"]["post_plans"]) == len(
        request.frozen_input.post_plans
    )
    assert prompt.metadata["contract_version"] == "content-v2"


def test_plan_alignment_accepts_matching_items() -> None:
    request = make_valid_generate_v2_request()
    plans = request.frozen_input.post_plans
    provider = MockContentProvider()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    items = asyncio.run(provider.generate_content_pack(prompt))

    result = validate_plan_alignment(plans, items)

    assert result.valid is True


def test_plan_alignment_rejects_count_mismatch() -> None:
    request = make_valid_generate_v2_request()
    plans = request.frozen_input.post_plans
    provider = MockContentProvider()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    items = asyncio.run(provider.generate_content_pack(prompt))[:2]

    result = validate_plan_alignment(plans, items)

    assert result.valid is False
    assert result.issues[0].code == "CONTENT_SCHEMA_FAILURE"
    assert result.issues[0].retryable is True


def test_plan_alignment_rejects_channel_drift() -> None:
    request = make_valid_generate_v2_request()
    plans = request.frozen_input.post_plans
    provider = MockContentProvider()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    items = asyncio.run(provider.generate_content_pack(prompt))
    items[1] = items[1].model_copy(update={"channel": "tiktok"})

    result = validate_plan_alignment(plans, items)

    assert result.valid is False
    assert result.issues[0].code == "CONTENT_CHANNEL_MISMATCH"


def test_v2_item_version_carries_generated_edit_metadata() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    provider = MockContentProvider()
    items = asyncio.run(provider.generate_content_pack(prompt))

    v2_item = to_v2_item_version(items[0])

    assert v2_item.contract_version == "content-v2"
    assert v2_item.edit_metadata.edit_kind == "generated"
    assert v2_item.edit_metadata.validation_state == "validated"
    assert v2_item.edit_metadata.base_version_id is None
    assert v2_item.version_checksum == compute_content_item_checksum(
        items[0]
    )


def test_text_post_does_not_acquire_an_automatic_image_dependency() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    item = asyncio.run(MockContentProvider().generate_content_pack(prompt))[0]
    text_item = item.model_copy(
        update={
            "format": "text_post",
            "asset_required": False,
            "asset_ids": [],
            "blockers": [],
        }
    )

    normalized = _normalize_v2_finalized_items([text_item])[0]

    assert normalized.asset_required is False
    assert normalized.asset_ids == []
    assert "CONTENT_ASSET_REQUIRED" not in normalized.blockers


def test_generate_v2_endpoint_returns_grounded_pack() -> None:
    def _settings() -> Settings:
        return Settings(
            ai_provider_mode="mock",
            image_provider_mode="mock",
            content_asset_storage_dir="/tmp/content-assets-test",
        )

    client = TestClient(app)
    app.dependency_overrides[get_settings] = _settings
    request = make_valid_generate_v2_request()
    try:
        response = client.post(
            "/internal/v1/ai/content/v2/generate",
            json=request.model_dump(mode="json"),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200, response.text
    body = AiContentV2GenerateResponse.model_validate(response.json())
    assert body.contract_version == "content-v2"
    assert body.content_pack.week_plan_id == request.frozen_input.week_plan_id
    assert body.content_pack.status == "draft"
    assert len(body.item_versions) == len(request.frozen_input.post_plans)
    for item, plan in zip(body.item_versions, request.frozen_input.post_plans):
        assert item.channel == plan.channel
        assert item.format == plan.format
        assert item.edit_metadata.edit_kind == "generated"


@pytest.mark.asyncio
async def test_v2_generation_normalizes_frozen_ctas_and_hashtag_shape() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    raw_items = await MockContentProvider().generate_content_pack(prompt)

    first = raw_items[0]
    invalid_claim = ContentClaimSource(
        claim_type="business_fact",
        source_type="strategy",
        source_path="strategy_plan.not_a_real_field",
        approved=True,
    )
    raw_items[0] = first.model_copy(
        update={
            "cta": "اطلب الآن",
            "claim_sources": [invalid_claim],
            "caption_variants": [
                variant.model_copy(update={"cta": "اطلب الآن"})
                for variant in first.caption_variants
            ],
        }
    )
    second = raw_items[1]
    raw_items[1] = second.model_copy(
        update={
            "hashtags": ["MarketMind مشروعك"],
            "caption_variants": [
                variant.model_copy(update={"hashtags": ["MarketMind مشروعك"]})
                for variant in second.caption_variants
            ],
        }
    )
    no_cta = raw_items[3]
    assert no_cta.short_video_script is not None
    raw_items[3] = no_cta.model_copy(
        update={
            "cta": "اشتر الآن",
            "caption_variants": [
                variant.model_copy(update={"cta": "اشتر الآن"})
                for variant in no_cta.caption_variants
            ],
            "short_video_script": no_cta.short_video_script.model_copy(
                update={"closing_cta": "اشتر الآن"}
            ),
        }
    )

    class OneShotProvider(MockContentProvider):
        name = "one-shot"
        model = "one-shot-model"

        def __init__(self, items: list[ContentItemVersion]) -> None:
            self.items = items
            self.calls = 0

        async def generate_content_pack(
            self,
            _prompt,
            *,
            max_output_tokens: int | None = None,
        ) -> list[ContentItemVersion]:
            del max_output_tokens
            self.calls += 1
            return self.items

    provider = OneShotProvider(raw_items)
    response = await generate_v2_content_pack(request, provider, breaker=None)

    destination = request.frozen_input.cta_entries[0].destination.value
    assert destination is not None
    assert provider.calls == 1
    assert destination in (response.item_versions[0].cta or "")
    assert (response.item_versions[0].cta or "").startswith("اطلب بالواتساب:")
    assert all(
        claim["source_path"] != "strategy_plan.not_a_real_field"
        for claim in response.item_versions[0].claim_sources
    )
    assert {
        claim["source_path"] for claim in response.item_versions[0].claim_sources
    } >= {"business_profile.profile", "strategy_plan.goal.text"}
    assert response.item_versions[1].hashtags == ["#MarketMind", "#مشروعك"]
    assert response.item_versions[1].caption_variants[0]["hashtags"] == [
        "#MarketMind",
        "#مشروعك",
    ]
    assert response.item_versions[2].hashtags == []
    assert response.item_versions[3].cta is None
    assert all(
        variant["cta"] is None
        for variant in response.item_versions[3].caption_variants
    )
    assert response.item_versions[3].short_video_script is not None
    assert response.item_versions[3].short_video_script["closing_cta"] is None


@pytest.mark.asyncio
async def test_v2_generation_derives_media_requirement_from_frozen_format() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    raw_items = await MockContentProvider().generate_content_pack(prompt)
    first = raw_items[0]
    raw_items[0] = first.model_copy(
        update={
            "asset_required": False,
            "asset_ids": [],
            "blockers": ["CONTENT_ASSET_REQUIRED"],
        }
    )

    class OneShotProvider(MockContentProvider):
        name = "one-shot-media"
        model = "one-shot-model"

        def __init__(self, items: list[ContentItemVersion]) -> None:
            self.items = items
            self.calls = 0

        async def generate_content_pack(
            self,
            _prompt,
            *,
            max_output_tokens: int | None = None,
        ) -> list[ContentItemVersion]:
            del max_output_tokens
            self.calls += 1
            return self.items

    provider = OneShotProvider(raw_items)
    response = await generate_v2_content_pack(request, provider, breaker=None)

    selected_media = request.frozen_input.post_plans[0].selected_media_ids
    assert provider.calls == 1
    assert response.item_versions[0].asset_required is True
    assert response.item_versions[0].asset_ids == selected_media
    assert "CONTENT_ASSET_REQUIRED" not in response.item_versions[0].blockers


@pytest.mark.asyncio
async def test_v2_generation_discards_script_from_non_video_card() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    raw_items = await MockContentProvider().generate_content_pack(prompt)
    video_script = next(
        item.short_video_script
        for item in raw_items
        if item.short_video_script is not None
    )
    non_video_index = next(
        index
        for index, plan in enumerate(request.frozen_input.post_plans)
        if plan.format != "short_video_script"
    )
    raw_items[non_video_index] = raw_items[non_video_index].model_copy(
        update={"short_video_script": video_script}
    )

    class OneShotProvider(MockContentProvider):
        name = "one-shot-script-shape"
        model = "one-shot-model"

        def __init__(self, items: list[ContentItemVersion]) -> None:
            self.items = items
            self.calls = 0

        async def generate_content_pack(
            self,
            _prompt,
            *,
            max_output_tokens: int | None = None,
        ) -> list[ContentItemVersion]:
            del max_output_tokens
            self.calls += 1
            return self.items

    provider = OneShotProvider(raw_items)
    response = await generate_v2_content_pack(request, provider, breaker=None)

    assert provider.calls == 1
    assert response.item_versions[non_video_index].short_video_script is None


@pytest.mark.asyncio
async def test_v2_generation_spends_repair_on_unsafe_copy_not_shape_noise() -> None:
    request = make_valid_generate_v2_request()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    invalid_items = list(valid_items)
    video_script = next(
        item.short_video_script
        for item in valid_items
        if item.short_video_script is not None
    )
    non_video_index = next(
        index
        for index, plan in enumerate(request.frozen_input.post_plans)
        if plan.format != "short_video_script"
    )
    invalid_item = invalid_items[non_video_index]
    invalid_variant = invalid_item.caption_variants[0].model_copy(
        update={"caption": "نحن الأفضل في السوق."}
    )
    invalid_items[non_video_index] = invalid_item.model_copy(
        update={
            "caption_variants": [invalid_variant],
            "short_video_script": video_script,
        }
    )

    class RepairOnceProvider(MockContentProvider):
        name = "repair-once"
        model = "repair-once-model"

        def __init__(self) -> None:
            self.calls = 0
            self.prompts = []

        async def generate_content_pack(
            self,
            current_prompt,
            *,
            max_output_tokens: int | None = None,
        ) -> list[ContentItemVersion]:
            del max_output_tokens
            self.calls += 1
            self.prompts.append(current_prompt)
            return invalid_items if self.calls == 1 else valid_items

    provider = RepairOnceProvider()
    response = await generate_v2_content_pack(
        request, provider, breaker=None, max_attempts=3
    )

    assert provider.calls == 2
    assert response.validation.valid is True
    assert "material superiority claim" in provider.prompts[1].user_prompt
    assert "short-video" not in provider.prompts[1].user_prompt


def _v2_revise_request() -> AiContentV2ReviseRequest:
    request = make_valid_generate_v2_request()
    provider = MockContentProvider()
    v1 = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(request, v1, "mock", "mock-model")
    items = asyncio.run(provider.generate_content_pack(prompt))
    base = to_v2_item_version(items[0])
    payload = request.model_dump(mode="json")
    payload["base_item_version"] = base.model_dump(mode="json")
    payload["revision_notes"] = "اجعل العنوان أكثر جاذبية"
    payload["content_item_id"] = base.content_item_id
    return AiContentV2ReviseRequest.model_validate(payload)


def test_v2_revise_returns_ai_rewrite_version() -> None:
    request = _v2_revise_request()
    provider = MockContentProvider()

    response = asyncio.run(
        revise_v2_content_item(request, provider, breaker=None)
    )

    assert response.contract_version == "content-v2"
    assert response.validation.valid is True
    item = response.item_version
    assert item.edit_metadata.edit_kind == "ai_rewrite"
    assert item.edit_metadata.base_version_id == request.base_item_version.id
    assert (
        item.edit_metadata.base_version_checksum
        == request.base_item_version.version_checksum
    )
    assert item.version == request.base_item_version.version + 1
    # Locked fields stay immutable.
    assert item.channel == request.base_item_version.channel
    assert item.format == request.base_item_version.format


def test_v2_revise_endpoint_returns_response() -> None:
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
    request = _v2_revise_request()
    try:
        response = client.post(
            "/internal/v1/ai/content/v2/revise",
            json=request.model_dump(mode="json"),
        )
    finally:
        fastapi_app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200, response.text
    body = AiContentV2ReviseResponse.model_validate(response.json())
    assert body.item_version.edit_metadata.edit_kind == "ai_rewrite"
