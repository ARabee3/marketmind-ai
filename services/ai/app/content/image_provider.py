"""Replaceable static-image providers and truthful Content asset outcomes."""

from __future__ import annotations

import base64
import hashlib
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone

from anyio import to_thread

from content_contracts import (
    AiStaticAssetGenerateRequest,
    ContentAsset,
)

from app.content.assembler import PromptAssembly
from app.content.storage_stub import AssetStoragePort
from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError


@dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    mime_type: str
    width: int
    height: int
    provider_request_id: str


class StaticImageProvider(ABC):
    """Provider boundary that returns bytes, never an authoritative storage URL."""

    name: str
    model: str

    @abstractmethod
    async def generate_static(
        self,
        request: AiStaticAssetGenerateRequest,
        prompt: PromptAssembly,
    ) -> GeneratedImage:
        raise NotImplementedError


class StaticImageProviderUnavailable(ProviderError):
    """Explicit configuration/provider-unavailable outcome."""

    def __init__(self, message: str = "Static image provider is unavailable.") -> None:
        super().__init__("CONTENT_PROVIDER_FAILURE", message, retryable=False)
        self.unavailable = True


class MockStaticImageProvider(StaticImageProvider):
    """Deterministic fake provider whose output is clearly test-generated."""

    name = "mock-image"
    model = "mock-static-image-v1"

    async def generate_static(
        self,
        request: AiStaticAssetGenerateRequest,
        prompt: PromptAssembly,
    ) -> GeneratedImage:
        digest = hashlib.sha256(
            f"{request.content_item_version_id}:{request.idempotency_key}:"
            f"{prompt.metadata.get('input_snapshot_hash', '')}".encode("utf-8")
        ).hexdigest()
        fake_bytes = f"MARKETMIND-FAKE-STATIC-IMAGE-V1:{digest}".encode("ascii")
        request_id = f"mock-image-{digest[:24]}"
        return GeneratedImage(
            data=fake_bytes,
            mime_type="image/png",
            width=request.width,
            height=request.height,
            provider_request_id=request_id,
        )


class UnavailableStaticImageProvider(StaticImageProvider):
    name = "unavailable-image"
    model = "unavailable"

    async def generate_static(
        self,
        request: AiStaticAssetGenerateRequest,
        prompt: PromptAssembly,
    ) -> GeneratedImage:
        raise StaticImageProviderUnavailable()


class FailingStaticImageProvider(StaticImageProvider):
    """Provider fake used to exercise truthful failure handling."""

    name = "failing-image"
    model = "failing-static-image-v1"

    def __init__(self, message: str = "Static image provider failed.") -> None:
        self.message = message

    async def generate_static(
        self,
        request: AiStaticAssetGenerateRequest,
        prompt: PromptAssembly,
    ) -> GeneratedImage:
        raise ProviderError("CONTENT_PROVIDER_FAILURE", self.message, retryable=True)


class OpenAIStaticImageProvider(StaticImageProvider):
    """OpenAI image adapter; returned bytes still pass through AssetStoragePort."""

    name = "openai-image"

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def generate_static(
        self,
        request: AiStaticAssetGenerateRequest,
        prompt: PromptAssembly,
    ) -> GeneratedImage:
        if not self.api_key:
            raise ProviderConfigError(
                "OPENAI_API_KEY is required for image_provider_mode=openai."
            )

        def call_openai() -> GeneratedImage:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(api_key=self.api_key, timeout=self.timeout_seconds)
            response = client.images.generate(
                model=self.model,
                prompt=prompt.user_prompt,
                size=f"{request.width}x{request.height}",
                response_format="b64_json",
            )
            image = response.data[0]
            if not image.b64_json:
                raise ProviderError(
                    "CONTENT_PROVIDER_FAILURE",
                    "OpenAI returned no image bytes.",
                    retryable=True,
                )
            return GeneratedImage(
                data=base64.b64decode(image.b64_json),
                mime_type="image/png",
                width=request.width,
                height=request.height,
                provider_request_id=getattr(response, "id", "openai-image-unknown"),
            )

        try:
            return await to_thread.run_sync(call_openai)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "OpenAI static-image provider call failed.",
                retryable=True,
            ) from exc


async def generate_static_asset(
    request: AiStaticAssetGenerateRequest,
    prompt: PromptAssembly,
    provider: StaticImageProvider,
    storage: AssetStoragePort,
) -> ContentAsset:
    """Generate, store, and return one truthful immutable ContentAsset record."""
    asset_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"content-asset:{request.content_item_version_id}:{request.idempotency_key}",
        )
    )
    created_at = datetime.now(timezone.utc)
    try:
        generated = await provider.generate_static(request, prompt)
        if not generated.data or not generated.mime_type.startswith("image/"):
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Static image provider returned unusable bytes.",
                retryable=False,
            )
        stored = await storage.store(
            generated.data,
            mime_type=generated.mime_type,
            width=generated.width,
            height=generated.height,
            asset_id=asset_id,
        )
        return ContentAsset(
            id=asset_id,
            content_item_version_id=request.content_item_version_id,
            kind="generated_static",
            status="ready",
            mime_type=stored.mime_type,
            storage_key=stored.storage_key,
            checksum=stored.checksum,
            width=stored.width,
            height=stored.height,
            alt_text=request.alt_text,
            provider_name=provider.name,
            provider_model=provider.model,
            provider_request_id=generated.provider_request_id,
            failure_code=None,
            created_at=created_at,
        )
    except StaticImageProviderUnavailable as error:
        return ContentAsset(
            id=asset_id,
            content_item_version_id=request.content_item_version_id,
            kind="prompt_only",
            status="missing",
            mime_type=None,
            storage_key=None,
            checksum=None,
            width=None,
            height=None,
            alt_text=request.alt_text,
            provider_name=provider.name,
            provider_model=provider.model,
            provider_request_id=None,
            failure_code=error.code,
            created_at=created_at,
        )
    except ProviderError as error:
        return ContentAsset(
            id=asset_id,
            content_item_version_id=request.content_item_version_id,
            kind="generated_static",
            status="failed",
            mime_type=None,
            storage_key=None,
            checksum=None,
            width=None,
            height=None,
            alt_text=request.alt_text,
            provider_name=provider.name,
            provider_model=provider.model,
            provider_request_id=None,
            failure_code=error.code,
            created_at=created_at,
        )
    except Exception:
        return ContentAsset(
            id=asset_id,
            content_item_version_id=request.content_item_version_id,
            kind="generated_static",
            status="failed",
            mime_type=None,
            storage_key=None,
            checksum=None,
            width=None,
            height=None,
            alt_text=request.alt_text,
            provider_name=provider.name,
            provider_model=provider.model,
            provider_request_id=None,
            failure_code="CONTENT_PROVIDER_FAILURE",
            created_at=created_at,
        )


def build_owner_supplied_asset(
    request: AiStaticAssetGenerateRequest,
    *,
    storage_key: str,
    checksum: str,
    mime_type: str,
    width: int,
    height: int,
) -> ContentAsset:
    """Represent an already-approved owner asset without provider provenance."""
    asset_id = str(
        uuid.uuid5(uuid.NAMESPACE_URL, f"owner-asset:{request.content_item_version_id}")
    )
    return ContentAsset(
        id=asset_id,
        content_item_version_id=request.content_item_version_id,
        kind="owner_supplied",
        status="ready",
        mime_type=mime_type,
        storage_key=storage_key,
        checksum=checksum,
        width=width,
        height=height,
        alt_text=request.alt_text,
        provider_name=None,
        provider_model=None,
        provider_request_id=None,
        failure_code=None,
        created_at=datetime.now(timezone.utc),
    )


def build_blocked_asset(request: AiStaticAssetGenerateRequest, code: str) -> ContentAsset:
    """Represent a deterministic asset-policy block without fake media."""
    return ContentAsset(
        id=request.content_item_version_id,
        content_item_version_id=request.content_item_version_id,
        kind="prompt_only",
        status="blocked",
        mime_type=None,
        storage_key=None,
        checksum=None,
        width=None,
        height=None,
        alt_text=request.alt_text,
        provider_name=None,
        provider_model=None,
        provider_request_id=None,
        failure_code=code,
        created_at=datetime.now(timezone.utc),
    )


def create_static_image_provider(settings: Settings) -> StaticImageProvider:
    if settings.image_provider_mode == "openai":
        return OpenAIStaticImageProvider(
            api_key=settings.openai_api_key,
            model=settings.image_model,
            timeout_seconds=settings.image_request_timeout_ms / 1000,
        )
    if settings.image_provider_mode == "unavailable":
        return UnavailableStaticImageProvider()
    return MockStaticImageProvider()
