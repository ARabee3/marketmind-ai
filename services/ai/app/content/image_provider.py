"""Replaceable static-image providers and truthful Content asset outcomes."""

from __future__ import annotations

import base64
import hashlib
import struct
import uuid
import zlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone

from anyio import to_thread

from content_contracts import (
    AiStaticAssetGenerateRequest,
    ContentAsset,
)

from app.content.assembler import PromptAssembly
from app.content.prompts import build_asset_image_prompt
from app.content.storage import AssetStoragePort
from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError


_SUPPORTED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
_RETRYABLE_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}
_RETRYABLE_EXCEPTION_NAMES = {
    "APIConnectionError",
    "APITimeoutError",
    "InternalServerError",
    "RateLimitError",
}


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
        color = bytes.fromhex(digest[:6])
        fake_bytes = _solid_png(request.width, request.height, color)
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
        _validate_openai_image_size(self.model, request.width, request.height)

        def call_openai() -> GeneratedImage:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(
                api_key=self.api_key,
                timeout=self.timeout_seconds,
                max_retries=0,
            )
            provider_prompt = build_asset_image_prompt(
                creative_brief=request.creative_brief,
                alt_text=request.alt_text,
                width=request.width,
                height=request.height,
            )
            arguments = {
                "model": self.model,
                "prompt": provider_prompt,
                "size": f"{request.width}x{request.height}",
                "n": 1,
            }
            if _is_gpt_image_model(self.model):
                arguments["output_format"] = "png"
            else:
                arguments["response_format"] = "b64_json"
            response = client.images.generate(**arguments)
            if not response.data:
                raise ProviderError(
                    "CONTENT_PROVIDER_FAILURE",
                    "OpenAI returned no image result.",
                    retryable=True,
                )
            image = response.data[0]
            if not image.b64_json:
                raise ProviderError(
                    "CONTENT_PROVIDER_FAILURE",
                    "OpenAI returned no image bytes.",
                    retryable=True,
                )
            return GeneratedImage(
                data=base64.b64decode(image.b64_json, validate=True),
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
                retryable=_is_retryable_provider_exception(exc),
            ) from exc


def _is_gpt_image_model(model: str) -> bool:
    return model.startswith("gpt-image-") or model == "chatgpt-image-latest"


def _validate_openai_image_size(model: str, width: int, height: int) -> None:
    requested = f"{width}x{height}"
    if model.startswith("gpt-image-2"):
        ratio = width / height
        if (
            width % 16 != 0
            or height % 16 != 0
            or not 1 / 3 <= ratio <= 3
            or width > 3840
            or height > 3840
        ):
            raise ProviderError(
                "CONTENT_SCHEMA_FAILURE",
                "The requested dimensions are unsupported by the configured OpenAI image model.",
                retryable=False,
            )
        return

    supported = {"1024x1024", "1536x1024", "1024x1536"}
    if model == "dall-e-2":
        supported = {"256x256", "512x512", "1024x1024"}
    elif model == "dall-e-3":
        supported = {"1024x1024", "1792x1024", "1024x1792"}
    if requested not in supported:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "The requested dimensions are unsupported by the configured OpenAI image model.",
            retryable=False,
        )


def _is_retryable_provider_exception(error: Exception) -> bool:
    status_code = getattr(error, "status_code", None)
    if not isinstance(status_code, int):
        status_code = getattr(error, "code", None)
    if isinstance(status_code, int):
        return status_code in _RETRYABLE_STATUS_CODES
    return isinstance(error, (ConnectionError, TimeoutError, OSError)) or (
        error.__class__.__name__ in _RETRYABLE_EXCEPTION_NAMES
    )


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(kind)
    checksum = zlib.crc32(payload, checksum)
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", checksum & 0xFFFFFFFF)
    )


def _solid_png(width: int, height: int, color: bytes) -> bytes:
    """Build a valid deterministic RGB PNG for clearly-labelled mock mode."""
    if width <= 0 or height <= 0 or len(color) != 3:
        raise ValueError("invalid mock PNG dimensions or color")
    row = b"\x00" + color * width
    pixels = row * height
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(pixels, level=9))
        + _png_chunk(b"IEND", b"")
    )


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


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
    if not storage.available:
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
            review_required=True,
            created_at=created_at,
        )
    try:
        generated = await provider.generate_static(request, prompt)
        if not generated.data or generated.mime_type not in _SUPPORTED_IMAGE_MIME_TYPES:
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Static image provider returned unusable bytes.",
                retryable=False,
            )
        if generated.width != request.width or generated.height != request.height:
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Static image provider returned unexpected dimensions.",
                retryable=False,
            )
        if generated.mime_type == "image/png" and _png_dimensions(generated.data) != (
            generated.width,
            generated.height,
        ):
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Static image provider returned invalid PNG bytes.",
                retryable=False,
            )
        stored = await storage.store(
            generated.data,
            mime_type=generated.mime_type,
            width=generated.width,
            height=generated.height,
            asset_id=asset_id,
        )
        expected_checksum = hashlib.sha256(generated.data).hexdigest()
        if (
            not stored.storage_key
            or stored.checksum != expected_checksum
            or stored.mime_type != generated.mime_type
            or stored.width != generated.width
            or stored.height != generated.height
        ):
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Asset storage returned inconsistent immutable metadata.",
                retryable=False,
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
            review_required=True,
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
            review_required=True,
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
            review_required=True,
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
            review_required=True,
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
        review_required=False,
        created_at=datetime.now(timezone.utc),
    )


def build_blocked_asset(request: AiStaticAssetGenerateRequest, code: str) -> ContentAsset:
    """Represent a deterministic asset-policy block without fake media."""
    return ContentAsset(
        id=str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"blocked-content-asset:{request.content_item_version_id}:{request.idempotency_key}",
            )
        ),
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
        review_required=True,
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
