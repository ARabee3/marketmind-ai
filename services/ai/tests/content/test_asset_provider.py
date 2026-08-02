"""Static-image provider, storage, provenance, and fallback tests."""

from __future__ import annotations

import base64
import hashlib
from types import SimpleNamespace

import pytest

from content_contracts import AiStaticAssetGenerateRequest

from app.content.assembler import assemble_asset_prompt
from app.content.image_provider import (
    FailingStaticImageProvider,
    MockStaticImageProvider,
    OpenAIStaticImageProvider,
    UnavailableStaticImageProvider,
    _solid_png,
    build_blocked_asset,
    build_owner_supplied_asset,
    create_static_image_provider,
    generate_static_asset,
)
from app.content.storage import (
    AssetStoragePort,
    DeterministicAssetStorage,
    FileSystemAssetStorage,
    StoredAsset,
    UnavailableAssetStorage,
)
from app.core.config import Settings
from app.providers.base import ProviderError


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
async def test_in_memory_test_storage_keeps_asset_identity_immutable() -> None:
    storage = DeterministicAssetStorage()
    asset_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    await storage.store(
        b"first-bytes",
        mime_type="image/png",
        width=1024,
        height=1024,
        asset_id=asset_id,
    )

    with pytest.raises(ValueError, match="different bytes"):
        await storage.store(
            b"different-bytes",
            mime_type="image/png",
            width=1024,
            height=1024,
            asset_id=asset_id,
        )


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


@pytest.mark.asyncio
async def test_unconfigured_durable_storage_skips_paid_provider_call() -> None:
    class CountingProvider(MockStaticImageProvider):
        def __init__(self) -> None:
            self.calls = 0

        async def generate_static(self, request, prompt):
            self.calls += 1
            return await super().generate_static(request, prompt)

    request = _request()
    provider = CountingProvider()

    asset = await generate_static_asset(
        request,
        _prompt(request),
        provider,
        UnavailableAssetStorage(),
    )

    assert provider.calls == 0
    assert asset.status == "failed"
    assert asset.storage_key is None


@pytest.mark.asyncio
async def test_filesystem_storage_is_durable_and_immutable(tmp_path) -> None:
    storage = FileSystemAssetStorage(tmp_path)
    first = await storage.store(
        b"first-bytes",
        mime_type="image/png",
        width=1024,
        height=1024,
        asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )

    assert await storage.retrieve(first.storage_key) == b"first-bytes"
    with pytest.raises(ValueError, match="different bytes"):
        await storage.store(
            b"different-bytes",
            mime_type="image/png",
            width=1024,
            height=1024,
            asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )
    with pytest.raises(ValueError, match="different metadata"):
        await storage.store(
            b"first-bytes",
            mime_type="image/jpeg",
            width=1024,
            height=1024,
            asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )


class InconsistentStorage(AssetStoragePort):
    async def store(
        self,
        data: bytes,
        *,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        return StoredAsset(
            storage_key="content/generated/wrong.png",
            checksum="wrong-checksum",
            mime_type=mime_type,
            width=width,
            height=height,
        )


@pytest.mark.asyncio
async def test_inconsistent_storage_metadata_cannot_become_ready() -> None:
    request = _request()
    asset = await generate_static_asset(
        request,
        _prompt(request),
        MockStaticImageProvider(),
        InconsistentStorage(),
    )

    assert asset.status == "failed"
    assert asset.checksum is None
    assert asset.storage_key is None


@pytest.mark.asyncio
async def test_gpt_image_adapter_omits_unsupported_response_format(monkeypatch) -> None:
    import openai

    request = _request().model_copy(update={"width": 1024, "height": 1024})
    prompt = _prompt(request)
    captured: dict = {}
    png = _solid_png(1024, 1024, b"\x10\x20\x30")

    class FakeImages:
        def generate(self, **arguments):
            captured["arguments"] = arguments
            return SimpleNamespace(
                id="image-request-fictional",
                data=[
                    SimpleNamespace(
                        b64_json=base64.b64encode(png).decode("ascii")
                    )
                ],
            )

    class FakeOpenAI:
        def __init__(self, **arguments):
            captured["client"] = arguments
            self.images = FakeImages()

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    provider = OpenAIStaticImageProvider("fictional-key", "gpt-image-1", 10)

    generated = await provider.generate_static(request, prompt)

    assert generated.data == png
    assert captured["client"]["max_retries"] == 0
    assert captured["arguments"]["output_format"] == "png"
    assert "response_format" not in captured["arguments"]


@pytest.mark.asyncio
async def test_openai_image_adapter_rejects_unsupported_size_before_call() -> None:
    request = _request()
    provider = OpenAIStaticImageProvider("fictional-key", "gpt-image-1", 10)

    with pytest.raises(ProviderError) as error:
        await provider.generate_static(request, _prompt(request))

    assert error.value.code == "CONTENT_SCHEMA_FAILURE"
    assert not error.value.retryable


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
