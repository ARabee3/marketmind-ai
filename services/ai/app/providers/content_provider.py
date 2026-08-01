"""Structured provider adapters for Content generation and revision."""

from __future__ import annotations

import copy
import json
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, time, timedelta, timezone
from typing import Any

from anyio import to_thread
from pydantic import BaseModel, ConfigDict, ValidationError

from content_contracts import (
    ContentCaptionVariant,
    ContentClaimSource,
    ContentGenerationProvenance,
    ContentItemVersion,
    ContentRecommendedWindow,
    ContentShortVideoScene,
    ContentShortVideoScript,
    ContentStrategyTrace,
)

from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError
from app.content.assembler import PromptAssembly
from app.content.fixtures import load_default_content_item_fixture
from app.content.validators import derive_strategy_pillar_ids


class ContentPackProviderOutput(BaseModel):
    """Internal structured-output wrapper; it is not a frozen wire contract."""

    model_config = ConfigDict(extra="forbid")
    item_versions: list[ContentItemVersion]


class ContentLLMProvider(ABC):
    """Provider that turns a Content prompt into structured item versions."""

    name: str

    @abstractmethod
    async def generate_content_pack(
        self, prompt: PromptAssembly
    ) -> list[ContentItemVersion]:
        raise NotImplementedError

    @abstractmethod
    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion:
        raise NotImplementedError


def _parse_provider_output(raw_output: Any) -> ContentPackProviderOutput:
    try:
        return ContentPackProviderOutput.model_validate(raw_output)
    except ValidationError as exc:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            f"Content provider output failed schema validation: {exc}",
            retryable=False,
        ) from exc


def _parse_json_provider_output(raw_text: str) -> ContentPackProviderOutput:
    try:
        raw_output = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            f"Content provider returned invalid JSON: {exc}",
            retryable=False,
        ) from exc
    return _parse_provider_output(raw_output)


class OpenAIContentProvider(ContentLLMProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def generate_content_pack(
        self, prompt: PromptAssembly
    ) -> list[ContentItemVersion]:
        return (await self._call_structured(prompt)).item_versions

    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion:
        output = await self._call_structured(prompt, minimum_items=1, maximum_items=1)
        return output.item_versions[0]

    async def _call_structured(
        self,
        prompt: PromptAssembly,
        *,
        minimum_items: int = 3,
        maximum_items: int = 5,
    ) -> ContentPackProviderOutput:
        if not self.api_key:
            raise ProviderConfigError(
                "OPENAI_API_KEY is required for AI_PROVIDER_MODE=openai."
            )
        if not self.model:
            raise ProviderConfigError(
                "OPENAI_MODEL is required for AI_PROVIDER_MODE=openai."
            )

        def call_openai() -> ContentPackProviderOutput:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(api_key=self.api_key, timeout=self.timeout_seconds)
            response = client.responses.parse(
                model=self.model,
                input=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
                text_format=ContentPackProviderOutput,
            )
            parsed = response.output_parsed
            if parsed is None:
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    "OpenAI returned no parsed Content output.",
                    retryable=False,
                )
            output = _parse_provider_output(parsed)
            if not minimum_items <= len(output.item_versions) <= maximum_items:
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    "OpenAI returned an invalid number of Content item versions.",
                    retryable=False,
                )
            return output

        try:
            return await to_thread.run_sync(call_openai)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "OpenAI Content provider call failed.",
                retryable=True,
            ) from exc


class GeminiContentProvider(ContentLLMProvider):
    name = "gemini_dev"

    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_ms = timeout_ms

    async def generate_content_pack(
        self, prompt: PromptAssembly
    ) -> list[ContentItemVersion]:
        return (await self._call_structured(prompt)).item_versions

    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion:
        output = await self._call_structured(prompt, minimum_items=1, maximum_items=1)
        return output.item_versions[0]

    async def _call_structured(
        self,
        prompt: PromptAssembly,
        *,
        minimum_items: int = 3,
        maximum_items: int = 5,
    ) -> ContentPackProviderOutput:
        if not self.api_key:
            raise ProviderConfigError(
                "GEMINI_API_KEY is required for AI_PROVIDER_MODE=gemini_dev."
            )
        if not self.model:
            raise ProviderConfigError(
                "GEMINI_MODEL is required for AI_PROVIDER_MODE=gemini_dev."
            )

        def call_gemini() -> ContentPackProviderOutput:
            try:
                from google import genai
                from google.genai import types
                from app.providers.strategy_provider import _strip_additional_properties
            except ImportError as exc:
                raise ProviderConfigError(
                    "The google-genai package is not installed."
                ) from exc

            schema = _strip_additional_properties(
                copy.deepcopy(ContentPackProviderOutput.model_json_schema())
            )
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=[prompt.user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=prompt.system_prompt,
                    response_mime_type="application/json",
                    response_schema=schema,
                    http_options=types.HttpOptions(timeout=self.timeout_ms),
                ),
            )
            output = _parse_json_provider_output(response.text or "{}")
            if not minimum_items <= len(output.item_versions) <= maximum_items:
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    "Gemini returned an invalid number of Content item versions.",
                    retryable=False,
                )
            return output

        try:
            return await to_thread.run_sync(call_gemini)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Gemini Content provider call failed.",
                retryable=True,
            ) from exc


class MockContentProvider(ContentLLMProvider):
    """Deterministic provider for local development and tests."""

    name = "mock"

    def __init__(self, fixture_item: ContentItemVersion | None = None) -> None:
        self.fixture_item = fixture_item or load_default_content_item_fixture()

    async def generate_content_pack(
        self, prompt: PromptAssembly
    ) -> list[ContentItemVersion]:
        context = _prompt_context(prompt)
        identity = context["generation_identity"]
        grounding = context["grounding_inputs"]
        strategy_week = grounding["strategy_week"]
        week_context = grounding["weekly_context"]
        channels = grounding["requested_channels"]
        formats = grounding["allowed_formats"]
        return [
            self._build_item(
                prompt,
                context,
                index=index,
                channel=channels[index % len(channels)],
                content_format=formats[index % len(formats)],
                strategy_week=strategy_week,
                week_context=week_context,
                identity=identity,
            )
            for index in range(3)
        ]

    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion:
        context = _prompt_context(prompt)
        previous = ContentItemVersion.model_validate(
            context["previous_item_version_read_only"]
        )
        data = previous.model_dump(mode="json")
        data["id"] = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"{previous.id}:v{previous.version + 1}")
        )
        data["version"] = previous.version + 1
        data["created_at"] = datetime.now(timezone.utc).isoformat()
        data["generation_provenance"] = _provenance(
            prompt,
            provider_name=self.name,
            provider_model=str(prompt.metadata.get("model", "mock")),
        ).model_dump(mode="json")
        data["version_checksum"] = _checksum(data)
        return ContentItemVersion.model_validate(data)

    def _build_item(
        self,
        prompt: PromptAssembly,
        context: dict[str, Any],
        *,
        index: int,
        channel: str,
        content_format: str,
        strategy_week: dict[str, Any],
        week_context: dict[str, Any],
        identity: dict[str, Any],
    ) -> ContentItemVersion:
        content_item_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"{identity['content_pack_id']}:content-item:{index + 1}",
            )
        )
        item_version_id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"{content_item_id}:version:1")
        )
        promotion = week_context.get("promotion")
        language_mode = context["generation_identity"]["language_mode"]
        cta = _cta_text(week_context, language_mode)
        caption = _caption_text(
            strategy_week["theme"],
            promotion["text"] if promotion else None,
            promotion.get("terms", []) if promotion else [],
            cta,
            language_mode,
        )
        if language_mode == "en":
            caption_variants = [
                ContentCaptionVariant(
                    locale="en",
                    caption=caption,
                    cta=cta,
                    hashtags=["#MarketMind", "#SmallBusiness"],
                )
            ]
        elif language_mode == "mixed":
            caption_variants = [
                ContentCaptionVariant(
                    locale="ar",
                    caption=_caption_text(
                        strategy_week["theme"],
                        promotion["text"] if promotion else None,
                        promotion.get("terms", []) if promotion else [],
                        cta,
                        "ar-EG",
                    ),
                    cta=cta,
                    hashtags=["#MarketMind", "#مشروعك"],
                ),
                ContentCaptionVariant(
                    locale="en",
                    caption=_caption_text(
                        strategy_week["theme"],
                        promotion["text"] if promotion else None,
                        promotion.get("terms", []) if promotion else [],
                        cta,
                        "en",
                    ),
                    cta=cta,
                    hashtags=["#MarketMind", "#SmallBusiness"],
                ),
            ]
        else:
            caption_variants = [
                ContentCaptionVariant(
                    locale="ar",
                    caption=caption,
                    cta=cta,
                    hashtags=["#MarketMind", "#مشروعك"],
                )
            ]
        asset_required = content_format in {"static_image_post", "carousel_brief"}
        asset_ids = week_context.get("approved_asset_ids", []) if asset_required else []
        script = None
        if content_format == "short_video_script":
            visual_direction = (
                "وجّه الصورة وفق الموجز الإبداعي المعتمد."
                if language_mode == "ar-EG"
                else "Show the visual direction from the approved creative brief."
            )
            script = ContentShortVideoScript(
                hook=f"{strategy_week['theme']}: فكرة عملية لعميلك",
                scenes=[
                    ContentShortVideoScene(
                        order=1,
                        visual_direction=visual_direction,
                        voiceover=caption,
                        on_screen_text=None,
                    )
                ],
                closing_cta=cta,
            )
        data = {
            "id": item_version_id,
            "contract_version": "content-v1",
            "content_item_id": content_item_id,
            "content_pack_id": identity["content_pack_id"],
            "version": 1,
            "channel": channel,
            "format": content_format,
            "language_mode": identity["language_mode"],
            "strategy_trace": {
                "strategy_id": identity["strategy_id"],
                "strategy_version": identity["strategy_version"],
                "week_number": identity["week_number"],
                "pillar_ids": derive_strategy_pillar_ids(
                    identity["strategy_id"], len(strategy_week["pillars"])
                ),
                "objective": strategy_week["objective"],
                "channel": channel,
            },
            "caption_variants": [variant.model_dump(mode="json") for variant in caption_variants],
            "cta": cta,
            "hashtags": caption_variants[0].hashtags,
            "creative_brief": (
                f"أنشئ محتوى {content_format} لموضوع الاستراتيجية: {strategy_week['theme']}."
                if language_mode == "ar-EG"
                else f"Create a {content_format} for the Strategy theme: {strategy_week['theme']}."
            ),
            "alt_text": (
                f"مرئي لموضوع {strategy_week['theme']}"
                if language_mode == "ar-EG"
                else f"Visual for {strategy_week['theme']}"
            )[:100],
            "short_video_script": script.model_dump(mode="json") if script else None,
            "recommended_publish_window": _publish_window(week_context["week_start_date"]),
            "claim_sources": _claim_sources(week_context),
            "warnings": [],
            "blockers": [],
            "asset_required": asset_required,
            "asset_ids": asset_ids,
            "generation_provenance": _provenance(
                prompt,
                provider_name=self.name,
                provider_model=str(prompt.metadata.get("model", "mock")),
            ).model_dump(mode="json"),
            "version_checksum": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        data["version_checksum"] = _checksum(data)
        return ContentItemVersion.model_validate(data)


def _prompt_context(prompt: PromptAssembly) -> dict[str, Any]:
    try:
        return json.loads(prompt.user_prompt.split("\n\n", 1)[1])
    except (IndexError, json.JSONDecodeError) as exc:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content prompt did not contain a valid structured context.",
            retryable=False,
        ) from exc


def _cta_text(week_context: dict[str, Any], language_mode: str) -> str | None:
    destination = week_context.get("cta_destination") or {}
    if destination.get("type") == "none":
        return None
    value = destination.get("value")
    if not value:
        return None
    if language_mode == "ar-EG":
        return f"تواصل معنا عبر {destination.get('type')}: {value}"
    return f"Contact us via {destination.get('type')}: {value}"


def _caption_text(
    theme: str,
    promotion_text: str | None,
    promotion_terms: list[str],
    cta: str | None,
    language_mode: str,
) -> str:
    if language_mode == "en":
        parts = [f"Explore this week’s focus: {theme}."]
        if promotion_text:
            parts.append(promotion_text)
        if promotion_terms:
            parts.append(f"Terms: {'; '.join(promotion_terms)}")
        if cta:
            parts.append(cta)
        return " ".join(parts)
    parts = [f"اكتشف موضوع هذا الأسبوع: {theme}."]
    if promotion_text:
        parts.append(promotion_text)
    if promotion_terms:
        parts.append(f"الشروط: {'؛ '.join(promotion_terms)}")
    if cta:
        parts.append(cta)
    return " ".join(parts)


def _publish_window(week_start_date: str) -> dict[str, Any]:
    start = datetime.combine(
        datetime.fromisoformat(week_start_date).date(),
        time(10, 0),
        tzinfo=timezone.utc,
    )
    return {
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(hours=2)).isoformat(),
        "timezone": "Africa/Cairo",
    }


def _claim_sources(week_context: dict[str, Any]) -> list[dict[str, Any]]:
    claims = [
        ContentClaimSource(
            claim_type="business_fact",
            source_type="profile",
            source_path="business_profile.profile",
            approved=True,
        ),
        ContentClaimSource(
            claim_type="business_fact",
            source_type="strategy",
            source_path="strategy_plan.content_strategy",
            approved=True,
        )
    ]
    if week_context.get("promotion_mode") == "owner_approved":
        claims.append(
            ContentClaimSource(
                claim_type="promotion",
                source_type="week_context",
                source_path="week_context.promotion",
                approved=True,
            )
        )
    return [claim.model_dump(mode="json") for claim in claims]


def _provenance(
    prompt: PromptAssembly,
    *,
    provider_name: str,
    provider_model: str,
) -> ContentGenerationProvenance:
    return ContentGenerationProvenance(
        generation_run_id=str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"content-generation:{prompt.metadata.get('input_snapshot_hash', '')}",
            )
        ),
        provider_name=provider_name,
        provider_model=provider_model,
        generated_at=datetime.now(timezone.utc),
    )


def _checksum(data: dict[str, Any]) -> str:
    payload = dict(data)
    payload.pop("version_checksum", None)
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    import hashlib

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def create_content_provider(settings: Settings) -> ContentLLMProvider:
    if settings.ai_provider_mode == "openai":
        return OpenAIContentProvider(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            timeout_seconds=settings.ai_request_timeout_ms / 1000,
        )
    if settings.ai_provider_mode == "gemini_dev":
        return GeminiContentProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            timeout_ms=settings.ai_request_timeout_ms,
        )
    return MockContentProvider()
