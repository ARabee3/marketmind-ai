"""Content v2 full-draft generation tests (frozen-input handoff, issue #187)."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from content_v2_contracts import (
    AiContentV2GenerateResponse,
    AiContentV2ReviseRequest,
    AiContentV2ReviseResponse,
)

from app.content.v2_generator import (
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
