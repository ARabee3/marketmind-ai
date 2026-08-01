"""FastAPI route tests for the Content internal boundary."""

from __future__ import annotations

from fastapi.testclient import TestClient

from content_contracts import (
    AiContentGenerateResponse,
    AiContentReviseResponse,
    AiStaticAssetGenerateResponse,
)

from app.core.config import Settings, get_settings
from app.main import app
from tests.content.fixture_helpers import load_example, make_valid_request


client = TestClient(app)


def _settings() -> Settings:
    return Settings(ai_provider_mode="mock", image_provider_mode="mock")


def test_content_generate_endpoint_returns_draft_pack() -> None:
    app.dependency_overrides[get_settings] = _settings
    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})

    try:
        response = client.post(
            "/internal/v1/ai/content/generate",
            json=request.model_dump(mode="json"),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200
    result = AiContentGenerateResponse.model_validate(response.json())
    assert result.validation.valid
    assert result.content_pack.status == "draft"
    assert len(result.item_versions) == 3
    assert all(item.content_pack_id == request.content_pack_id for item in result.item_versions)


def test_content_generate_endpoint_rejects_channel_mismatch() -> None:
    app.dependency_overrides[get_settings] = _settings
    request = make_valid_request().model_copy(
        update={"selected_channels": ["facebook"], "allowed_formats": ["text_post"]}
    )

    try:
        response = client.post(
            "/internal/v1/ai/content/generate",
            json=request.model_dump(mode="json"),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 422
    assert response.json()["detail"]["error_type"] == "CONTENT_CHANNEL_MISMATCH"


def test_content_generate_endpoint_maps_provider_configuration_failure() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(ai_provider_mode="openai")
    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})

    try:
        response = client.post(
            "/internal/v1/ai/content/generate",
            json=request.model_dump(mode="json"),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 422
    assert response.json()["detail"]["error_type"] == "CONTENT_PROVIDER_FAILURE"


def test_content_revision_endpoint_returns_new_version() -> None:
    app.dependency_overrides[get_settings] = _settings
    item_data = load_example("content-pack-week-1-ar.example.json")["item_version"]
    request_data = {
        "contract_version": "content-v1",
        "content_pack_id": item_data["content_pack_id"],
        "content_item_id": item_data["content_item_id"],
        "base_item_version_id": item_data["id"],
        "revision_notes": "اجعل الدعوة إلى الإجراء أوضح.",
        "idempotency_key": "endpoint-revision-fictional",
    }
    body = {
        "request": request_data,
        "previous_item_version": item_data,
    }

    try:
        response = client.post("/internal/v1/ai/content/revise", json=body)
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200
    result = AiContentReviseResponse.model_validate(response.json())
    assert result.validation.valid
    assert result.item_version.version == 2
    assert result.item_version.id != item_data["id"]


def test_content_revision_endpoint_requires_read_only_base_version() -> None:
    app.dependency_overrides[get_settings] = _settings
    request = make_valid_request()
    body = {
        "request": {
            "contract_version": "content-v1",
            "content_pack_id": request.content_pack_id,
            "content_item_id": "88888888-8888-4888-8888-888888888888",
            "base_item_version_id": "99999999-9999-4999-8999-999999999999",
            "revision_notes": "Make the CTA clearer.",
            "idempotency_key": "missing-base-fictional",
        }
    }

    try:
        response = client.post("/internal/v1/ai/content/revise", json=body)
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 422


def test_static_asset_endpoint_returns_generated_ready_asset() -> None:
    app.dependency_overrides[get_settings] = _settings
    request = {
        "contract_version": "content-v1",
        "content_item_version_id": "99999999-9999-4999-8999-999999999999",
        "creative_brief": "Fictional static image brief.",
        "alt_text": "Fictional asset",
        "width": 1080,
        "height": 1080,
        "idempotency_key": "endpoint-asset-fictional",
    }

    try:
        response = client.post(
            "/internal/v1/ai/content/assets/generate-static",
            json=request,
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200
    result = AiStaticAssetGenerateResponse.model_validate(response.json())
    assert result.validation.valid
    assert result.asset.kind == "generated_static"
    assert result.asset.status == "ready"
    assert result.asset.storage_key
    assert result.asset.checksum


def test_static_asset_endpoint_exposes_provider_unavailable_state() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        ai_provider_mode="mock",
        image_provider_mode="unavailable",
    )
    request = {
        "contract_version": "content-v1",
        "content_item_version_id": "99999999-9999-4999-8999-999999999999",
        "creative_brief": "Fictional static image brief.",
        "alt_text": "Fictional asset",
        "width": 1080,
        "height": 1080,
        "idempotency_key": "endpoint-unavailable-fictional",
    }

    try:
        response = client.post(
            "/internal/v1/ai/content/assets/generate-static",
            json=request,
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200
    result = AiStaticAssetGenerateResponse.model_validate(response.json())
    assert not result.validation.valid
    assert result.asset.kind == "prompt_only"
    assert result.asset.status == "missing"
    assert result.asset.storage_key is None
