"""Static-image provider, storage, provenance, and fallback tests."""

from __future__ import annotations

import hashlib

import pytest

from content_contracts import AiStaticAssetGenerateRequest

from app.content.assembler import assemble_asset_prompt
from app.content.image_provider import (
    FailingStaticImageProvider,
    MockStaticImageProvider,
    UnavailableStaticImageProvider,
    build_blocked_asset,
    build_owner_supplied_asset,
    create_static_image_provider,
    generate_static_asset,
)
from app.content.storage_stub import AssetStoragePort, DeterministicAssetStorage, StoredAsset
from app.core.config import Settings


def _request() -> AiStaticAssetGenerateRequest:
    return AiStaticAssetGenerateRequest(
        contract_version="content-v1",
        content_item_version_id="99999999-9999-4999-8999-999999999999",
        creative_brief="Fictional static image for a grounded local business post.",
        alt_text="Fictional local business product image",
        width=1080,
        height=1080,
        idempotency_key="asset-phase-seven-fictional",
    )


def _prompt(request: AiStaticAssetGenerateRequest):
    return assemble_asset_prompt(request, "mock-image", "mock-static-image-v1")


@pytest.mark.asyncio
async def test_mock_image_is_stored_with_provenance_and_checksum() -> None:
    request = _request()
    storage = DeterministicAssetStorage()
    asset = await generate_static_asset(
        request,
        _prompt(request),
        MockStaticImageProvider(),
        storage,
    )

    assert asset.kind == "generated_static"
    assert asset.status == "ready"
    assert asset.storage_key
    assert asset.checksum
    assert asset.provider_name == "mock-image"
    assert asset.provider_model == "mock-static-image-v1"
    assert asset.provider_request_id
    stored_bytes = await storage.retrieve(asset.storage_key)
    assert asset.checksum == hashlib.sha256(stored_bytes).hexdigest()
    assert asset.content_item_version_id == request.content_item_version_id


@pytest.mark.asyncio
async def test_unavailable_provider_returns_explicit_prompt_only_state() -> None:
    request = _request()
    asset = await generate_static_asset(
        request,
        _prompt(request),
        UnavailableStaticImageProvider(),
        DeterministicAssetStorage(),
    )

    assert asset.kind == "prompt_only"
    assert asset.status == "missing"
    assert asset.storage_key is None
    assert asset.checksum is None
    assert asset.failure_code == "CONTENT_PROVIDER_FAILURE"


@pytest.mark.asyncio
async def test_provider_failure_cannot_masquerade_as_generated_ready_asset() -> None:
    request = _request()
    asset = await generate_static_asset(
        request,
        _prompt(request),
        FailingStaticImageProvider(),
        DeterministicAssetStorage(),
    )

    assert asset.kind == "generated_static"
    assert asset.status == "failed"
    assert asset.storage_key is None
    assert asset.checksum is None
    assert asset.failure_code == "CONTENT_PROVIDER_FAILURE"


class FailingStorage(AssetStoragePort):
    async def store(
        self,
        data: bytes,
        *,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        raise OSError("storage unavailable")


@pytest.mark.asyncio
async def test_storage_failure_is_explicit_and_has_no_authoritative_reference() -> None:
    request = _request()
    asset = await generate_static_asset(
        request,
        _prompt(request),
        MockStaticImageProvider(),
        FailingStorage(),
    )

    assert asset.status == "failed"
    assert asset.storage_key is None
    assert asset.checksum is None
    assert asset.failure_code == "CONTENT_PROVIDER_FAILURE"


def test_owner_supplied_asset_is_ready_without_provider_provenance() -> None:
    request = _request()

    asset = build_owner_supplied_asset(
        request,
        storage_key="content/test/owner-photo.jpg",
        checksum="sha256-owner-photo",
        mime_type="image/jpeg",
        width=1080,
        height=1080,
    )

    assert asset.kind == "owner_supplied"
    assert asset.status == "ready"
    assert asset.provider_name is None
    assert asset.provider_request_id is None
    assert asset.storage_key == "content/test/owner-photo.jpg"


def test_blocked_asset_has_no_fake_media() -> None:
    asset = build_blocked_asset(_request(), "CONTENT_POLICY_VIOLATION")

    assert asset.kind == "prompt_only"
    assert asset.status == "blocked"
    assert asset.storage_key is None
    assert asset.checksum is None
    assert asset.failure_code == "CONTENT_POLICY_VIOLATION"


def test_image_provider_factory_has_separate_configuration_mode() -> None:
    assert create_static_image_provider(Settings(image_provider_mode="mock")).name == "mock-image"
    assert (
        create_static_image_provider(Settings(image_provider_mode="unavailable")).name
        == "unavailable-image"
    )
