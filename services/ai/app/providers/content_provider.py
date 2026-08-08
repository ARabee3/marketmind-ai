"""Structured provider adapters for Content generation and revision."""

from __future__ import annotations

import copy
import json
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

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
from content_v2_contracts import ContentPostPlanDraftV2

from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError
from app.content.assembler import PromptAssembly
from app.content.validators import (
    compute_content_item_checksum,
    derive_target_item_count,
)
from app.providers.openrouter_provider import OPENROUTER_BASE_URL


_RETRYABLE_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}
_RETRYABLE_EXCEPTION_NAMES = {
    "APIConnectionError",
    "APITimeoutError",
    "InternalServerError",
    "RateLimitError",
}


class ContentPackProviderOutput(BaseModel):
    """Internal structured-output wrapper; it is not a frozen wire contract."""

    model_config = ConfigDict(extra="forbid")
    item_versions: list[ContentItemVersion]


class ContentPlanProviderOutput(BaseModel):
    """Internal structured-output wrapper for the planner stage."""

    model_config = ConfigDict(extra="forbid")
    post_plans: list[ContentPostPlanDraftV2]


class ContentLLMProvider(ABC):
    """Provider that turns a Content prompt into structured item versions."""

    name: str

    @abstractmethod
    async def generate_content_pack(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentItemVersion]:
        raise NotImplementedError

    async def generate_content_plan(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentPostPlanDraftV2]:
        """Planner stage: high-level post cards only, never publishable copy.

        Concrete default so light-weight test fakes stay valid; production
        providers override it.
        """
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "This Content provider does not implement the planner stage.",
            retryable=False,
        )

    @abstractmethod
    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion:
        raise NotImplementedError


def _parse_provider_output(
    raw_output: Any,
    model: type[ContentPackProviderOutput]
    | type[ContentPlanProviderOutput] = ContentPackProviderOutput,
) -> ContentPackProviderOutput | ContentPlanProviderOutput:
    try:
        return model.model_validate(raw_output)
    except ValidationError as exc:
        safe_errors = [
            {
                "location": ".".join(str(part) for part in error["loc"]),
                "type": error["type"],
                "message": error["msg"],
            }
            for error in exc.errors(
                include_url=False,
                include_context=False,
                include_input=False,
            )[:5]
        ]
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content provider output failed schema validation: "
            f"{json.dumps(safe_errors, ensure_ascii=False)}",
            retryable=False,
        ) from exc


def _parse_json_provider_output(
    raw_text: str,
    model: type[ContentPackProviderOutput] | type[ContentPlanProviderOutput] = ContentPackProviderOutput,
) -> ContentPackProviderOutput | ContentPlanProviderOutput:
    try:
        raw_output = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            f"Content provider returned invalid JSON: {exc}",
            retryable=False,
        ) from exc
    return _parse_provider_output(raw_output, model)


def _is_retryable_provider_exception(error: Exception) -> bool:
    status_code = getattr(error, "status_code", None)
    if not isinstance(status_code, int):
        status_code = getattr(error, "code", None)
    if isinstance(status_code, int):
        return status_code in _RETRYABLE_STATUS_CODES
    return isinstance(error, (ConnectionError, TimeoutError, OSError)) or (
        error.__class__.__name__ in _RETRYABLE_EXCEPTION_NAMES
    )


class OpenAIContentProvider(ContentLLMProvider):
    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float,
        *,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.top_p = top_p

    async def generate_content_pack(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentItemVersion]:
        return (await self._call_structured(prompt, max_output_tokens=max_output_tokens)).item_versions

    async def generate_content_plan(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentPostPlanDraftV2]:
        output = await self._call_structured(
            prompt,
            output_model=ContentPlanProviderOutput,
            output_field="post_plans",
            max_output_tokens=max_output_tokens,
        )
        return output.post_plans

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
        max_output_tokens: int | None = None,
        output_model: type[ContentPackProviderOutput]
        | type[ContentPlanProviderOutput] = ContentPackProviderOutput,
        output_field: str = "item_versions",
    ) -> ContentPackProviderOutput | ContentPlanProviderOutput:
        if not self.api_key:
            raise ProviderConfigError(
                "OPENAI_API_KEY is required for AI_PROVIDER_MODE=openai."
            )
        if not self.model:
            raise ProviderConfigError(
                "OPENAI_MODEL is required for AI_PROVIDER_MODE=openai."
            )

        def call_openai() -> ContentPackProviderOutput | ContentPlanProviderOutput:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(
                api_key=self.api_key,
                timeout=self.timeout_seconds,
                max_retries=0,
            )
            sampling: dict[str, float] = {}
            if self.temperature is not None:
                sampling["temperature"] = self.temperature
            if self.top_p is not None:
                sampling["top_p"] = self.top_p
            response = client.responses.parse(
                model=self.model,
                store=False,
                input=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
                text_format=output_model,
                **sampling,
                **(
                    {"max_output_tokens": max_output_tokens}
                    if max_output_tokens is not None
                    else {}
                ),
            )
            parsed = response.output_parsed
            if parsed is None:
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    "OpenAI returned no parsed Content output.",
                    retryable=False,
                )
            output = _parse_provider_output(parsed, output_model)
            if not minimum_items <= len(getattr(output, output_field)) <= maximum_items:
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    f"OpenAI returned an invalid number of {output_field}.",
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
                retryable=_is_retryable_provider_exception(exc),
            ) from exc


class GeminiContentProvider(ContentLLMProvider):
    name = "gemini_dev"

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_ms: int,
        *,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_ms = timeout_ms
        self.temperature = temperature
        self.top_p = top_p

    async def generate_content_pack(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentItemVersion]:
        return (await self._call_structured(prompt, max_output_tokens=max_output_tokens)).item_versions

    async def generate_content_plan(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentPostPlanDraftV2]:
        output = await self._call_structured(
            prompt,
            output_model=ContentPlanProviderOutput,
            output_field="post_plans",
            max_output_tokens=max_output_tokens,
        )
        return output.post_plans

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
        max_output_tokens: int | None = None,
        output_model: type[ContentPackProviderOutput]
        | type[ContentPlanProviderOutput] = ContentPackProviderOutput,
        output_field: str = "item_versions",
    ) -> ContentPackProviderOutput | ContentPlanProviderOutput:
        if not self.api_key:
            raise ProviderConfigError(
                "GEMINI_API_KEY is required for AI_PROVIDER_MODE=gemini_dev."
            )
        if not self.model:
            raise ProviderConfigError(
                "GEMINI_MODEL is required for AI_PROVIDER_MODE=gemini_dev."
            )

        def call_gemini() -> ContentPackProviderOutput | ContentPlanProviderOutput:
            try:
                from google import genai
                from google.genai import types
                from app.providers.strategy_provider import _strip_additional_properties
            except ImportError as exc:
                raise ProviderConfigError(
                    "The google-genai package is not installed."
                ) from exc

            schema = _strip_additional_properties(
                copy.deepcopy(output_model.model_json_schema())
            )
            sampling: dict[str, float] = {}
            if self.temperature is not None:
                sampling["temperature"] = self.temperature
            if self.top_p is not None:
                sampling["top_p"] = self.top_p
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=[prompt.user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=prompt.system_prompt,
                    response_mime_type="application/json",
                    response_schema=schema,
                    http_options=types.HttpOptions(timeout=self.timeout_ms),
                    **(
                        {"max_output_tokens": max_output_tokens}
                        if max_output_tokens is not None
                        else {}
                    ),
                    **sampling,
                ),
            )
            output = _parse_json_provider_output(response.text or "{}", output_model)
            if not minimum_items <= len(getattr(output, output_field)) <= maximum_items:
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    f"Gemini returned an invalid number of {output_field}.",
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
                retryable=_is_retryable_provider_exception(exc),
            ) from exc


class OpenRouterContentProvider(ContentLLMProvider):
    """OpenRouter adapter using the same strict Content wrapper schema."""

    name = "openrouter"

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float,
        *,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.top_p = top_p

    async def generate_content_pack(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentItemVersion]:
        return (await self._call_structured(prompt, max_output_tokens=max_output_tokens)).item_versions

    async def generate_content_plan(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentPostPlanDraftV2]:
        output = await self._call_structured(
            prompt,
            output_model=ContentPlanProviderOutput,
            output_field="post_plans",
            max_output_tokens=max_output_tokens,
        )
        return output.post_plans

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
        max_output_tokens: int | None = None,
        output_model: type[ContentPackProviderOutput]
        | type[ContentPlanProviderOutput] = ContentPackProviderOutput,
        output_field: str = "item_versions",
    ) -> ContentPackProviderOutput | ContentPlanProviderOutput:
        if not self.api_key:
            raise ProviderConfigError(
                "OPEN_ROUTER_API_KEY is required for AI_PROVIDER_MODE=openrouter."
            )
        if not self.model:
            raise ProviderConfigError(
                "OPEN_ROUTER_MODEL is required for AI_PROVIDER_MODE=openrouter."
            )

        def call_openrouter() -> ContentPackProviderOutput | ContentPlanProviderOutput:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(
                api_key=self.api_key,
                base_url=OPENROUTER_BASE_URL,
                timeout=self.timeout_seconds,
                max_retries=0,
            )
            sampling: dict[str, float] = {}
            if self.temperature is not None:
                sampling["temperature"] = self.temperature
            if self.top_p is not None:
                sampling["top_p"] = self.top_p
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "content_plan_provider_output",
                        "strict": True,
                        "schema": output_model.model_json_schema(),
                    },
                },
                **(
                    {"max_tokens": max_output_tokens}
                    if max_output_tokens is not None
                    else {}
                ),
                **sampling,
            )
            if not response.choices:
                raise ProviderError(
                    "CONTENT_PROVIDER_FAILURE",
                    "OpenRouter returned no Content choices.",
                    retryable=True,
                )
            content = response.choices[0].message.content
            if not isinstance(content, str) or not content.strip():
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    "OpenRouter returned empty Content output.",
                    retryable=False,
                )
            output = _parse_json_provider_output(content, output_model)
            if not minimum_items <= len(getattr(output, output_field)) <= maximum_items:
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    f"OpenRouter returned an invalid number of {output_field}.",
                    retryable=False,
                )
            return output

        try:
            return await to_thread.run_sync(call_openrouter)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "OpenRouter Content provider call failed.",
                retryable=_is_retryable_provider_exception(exc),
            ) from exc


class MockContentProvider(ContentLLMProvider):
    """Deterministic provider for local development and tests."""

    name = "mock"

    async def generate_content_pack(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentItemVersion]:
        context = prompt.context
        identity = context["generation_identity"]
        grounding = context["grounding_inputs"]
        strategy_week = grounding["strategy_week"]
        week_context = grounding["weekly_context"]
        channels = grounding["requested_channels"]
        formats = grounding["allowed_formats"]
        item_count = derive_target_item_count(strategy_week["weekly_cadence"])
        if item_count is None or not 3 <= item_count <= 5:
            item_count = 3
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
            for index in range(item_count)
        ]

    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion:
        context = prompt.context
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
        item = ContentItemVersion.model_validate(data)
        return item.model_copy(
            update={"version_checksum": compute_content_item_checksum(item)}
        )

    async def generate_content_plan(
        self,
        prompt: PromptAssembly,
        *,
        max_output_tokens: int | None = None,
    ) -> list[ContentPostPlanDraftV2]:
        """Deterministic planner cards: 3-5 high-level post plans only."""
        context = prompt.context
        identity = context["plan_identity"]
        grounding = context["grounding_inputs"]
        channels = grounding["allowed_channels"]
        formats = grounding["allowed_formats"]
        cta_entries = grounding["cta_library"]
        media_entries = grounding["media_library"]
        focus = grounding["strategy_week"]["focus"]
        language = identity["language_mode"]
        item_count = 3
        suffix = "الغداء السريع" if language != "en" else "fast lunch"
        return [
            ContentPostPlanDraftV2(
                purpose=(
                    f"{focus} — منشور {index + 1} يستهدف {suffix}."
                    if language != "en"
                    else f"{focus} — post {index + 1} targeting {suffix}."
                ),
                intended_audience="موظفو المكاتب القريبة" if language != "en" else "nearby office workers",
                channel=channels[index % len(channels)],
                format=formats[index % len(formats)],
                cta_library_entry_id=(
                    cta_entries[0]["id"]
                    if index == 0 and cta_entries
                    else None
                ),
                owner_instructions=None,
                visual_direction=(
                    grounding["editorial_profile"]["default_visual_guidance"]
                    if index == 0
                    else None
                ),
                selected_media_ids=(
                    [media_entries[0]["id"]]
                    if index == 0 and media_entries
                    else []
                ),
            )
            for index in range(item_count)
        ]

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
        """Produce a ContentItemVersion with index-driven distinctiveness."""
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
        must_include = week_context.get("must_include", [])
        hooks_ar = [
            "هل تعلم أن",
            "اكتشف السر وراء",
            "نصيحة سريعة من",
            "خلّي بالك من",
            "سرّ النجاح في",
        ]
        hooks_en = [
            "Did you know that",
            "Discover the secret behind",
            "A quick tip from",
            "Watch out for",
            "The key to success in",
        ]
        hooks = hooks_en if language_mode == "en" else hooks_ar
        hook = hooks[index % len(hooks)]
        if language_mode == "en":
            cta = _cta_text(week_context, "en")
            caption_variants = [
                ContentCaptionVariant(
                    locale="en",
                    caption=_caption_text(
                        strategy_week["theme"],
                        promotion["text"] if promotion else None,
                        promotion.get("terms", []) if promotion else [],
                        must_include,
                        cta,
                        "en",
                        hook=hook,
                    ),
                    cta=cta,
                    hashtags=["#MarketMind", "#SmallBusiness"],
                )
            ]
        elif language_mode == "mixed":
            cta = _cta_text(week_context, "ar-EG")
            english_cta = _cta_text(week_context, "en")
            caption_variants = [
                ContentCaptionVariant(
                    locale="ar",
                    caption=_caption_text(
                        strategy_week["theme"],
                        promotion["text"] if promotion else None,
                        promotion.get("terms", []) if promotion else [],
                        must_include,
                        cta,
                        "ar-EG",
                        hook=hooks_ar[index % len(hooks_ar)],
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
                        must_include,
                        english_cta,
                        "en",
                        hook=hooks_en[index % len(hooks_en)],
                    ),
                    cta=english_cta,
                    hashtags=["#MarketMind", "#SmallBusiness"],
                ),
            ]
        else:
            cta = _cta_text(week_context, "ar-EG")
            caption_variants = [
                ContentCaptionVariant(
                    locale="ar",
                    caption=_caption_text(
                        strategy_week["theme"],
                        promotion["text"] if promotion else None,
                        promotion.get("terms", []) if promotion else [],
                        must_include,
                        cta,
                        "ar-EG",
                        hook=hooks_ar[index % len(hooks_ar)],
                    ),
                    cta=cta,
                    hashtags=["#MarketMind", "#مشروعك"],
                )
            ]
        caption_variants = [
            variant.model_copy(
                update={
                    "caption": (
                        f"{variant.caption} فكرة المحتوى {index + 1}."
                        if variant.locale == "ar"
                        else f"{variant.caption} Content idea {index + 1}."
                    )
                }
            )
            for variant in caption_variants
        ]
        if channel == "google_business_profile":
            caption_variants = [
                variant.model_copy(update={"hashtags": []})
                for variant in caption_variants
            ]
        caption = caption_variants[0].caption
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
                hook=(
                    f"{hook} {strategy_week['theme']}"
                    if language_mode != "en"
                    else f"{strategy_week['theme']}: {hook.lower()} a practical idea"
                ),
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
        pillar_count = len(strategy_week["pillars"])
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
                "pillar_ids": [
                    strategy_week["pillars"][
                        index % pillar_count
                    ]["pillar_id"]
                ],
                "objective": strategy_week["objective"],
                "channel": channel,
            },
            "caption_variants": [variant.model_dump(mode="json") for variant in caption_variants],
            "cta": cta,
            "hashtags": caption_variants[0].hashtags,
            "creative_brief": (
                f"أنشئ محتوى {content_format} للفكرة {index + 1} بزاوية '{hook}' لموضوع الاستراتيجية: {strategy_week['theme']}."
                if language_mode == "ar-EG"
                else f"Create {content_format} idea {index + 1} with angle '{hook}' for the Strategy theme: {strategy_week['theme']}."
            ),
            "alt_text": (
                f"مرئي للفكرة {index + 1} بزاوية '{hook}' عن {strategy_week['theme']}"
                if language_mode == "ar-EG"
                else f"Visual for idea {index + 1} with angle '{hook}': {strategy_week['theme']}"
            )[:100],
            "short_video_script": script.model_dump(mode="json") if script else None,
            "recommended_publish_window": _publish_window(
                week_context["week_start_date"],
                day_offset=index,
            ),
            "claim_sources": _claim_sources(week_context),
            "warnings": [],
            "blockers": ["CONTENT_ASSET_REQUIRED"] if asset_required and not asset_ids else [],
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
        item = ContentItemVersion.model_validate(data)
        return item.model_copy(
            update={"version_checksum": compute_content_item_checksum(item)}
        )


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
    must_include: list[str],
    cta: str | None,
    language_mode: str,
    *,
    hook: str = "",
) -> str:
    owner_requirements = [
        _owner_requirement_copy(requirement) for requirement in must_include
    ]
    hook_prefix = f"{hook} " if hook else ""
    if language_mode == "en":
        parts = [f"{hook_prefix}Explore this week's focus: {theme}."]
        if promotion_text:
            parts.append(promotion_text)
        if promotion_terms:
            parts.append(f"Terms: {'; '.join(promotion_terms)}")
        parts.extend(owner_requirements)
        if cta:
            parts.append(cta)
        return " ".join(parts)
    parts = [f"{hook_prefix}اكتشف موضوع هذا الأسبوع: {theme}."]
    if promotion_text:
        parts.append(promotion_text)
    if promotion_terms:
        parts.append(f"الشروط: {'؛ '.join(promotion_terms)}")
    parts.extend(owner_requirements)
    if cta:
        parts.append(cta)
    return " ".join(parts)


def _owner_requirement_copy(requirement: str) -> str:
    """Turn common directive prefixes into clearly simulated mock copy."""
    normalized = requirement.strip()
    prefixes = (
        "mention ",
        "include ",
        "use ",
        "اذكر ",
        "أذكر ",
        "ضمّن ",
        "ضمن ",
        "استخدم ",
    )
    folded = normalized.casefold()
    for prefix in prefixes:
        if folded.startswith(prefix.casefold()):
            normalized = normalized[len(prefix) :].strip()
            break
    if not normalized:
        return requirement.strip()
    return normalized if normalized.endswith((".", "!", "؟", "?")) else f"{normalized}."


def _publish_window(week_start_date: str, *, day_offset: int) -> dict[str, Any]:
    start = datetime.combine(
        datetime.fromisoformat(week_start_date).date(),
        time(10, 0),
        tzinfo=ZoneInfo("Africa/Cairo"),
    ) + timedelta(days=day_offset)
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
        ),
    ]
    if week_context.get("must_include"):
        claims.append(
            ContentClaimSource(
                claim_type="business_fact",
                source_type="week_context",
                source_path="week_context.must_include",
                approved=True,
            )
        )
    destination = week_context.get("cta_destination") or {}
    if destination.get("type") != "none" and destination.get("value"):
        claims.append(
            ContentClaimSource(
                claim_type="business_fact",
                source_type="week_context",
                source_path="week_context.cta_destination",
                approved=True,
            )
        )
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


def create_content_provider(settings: Settings) -> ContentLLMProvider:
    if settings.ai_provider_mode == "openai":
        return OpenAIContentProvider(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            timeout_seconds=settings.ai_request_timeout_ms / 1000,
            temperature=settings.ai_temperature,
            top_p=settings.ai_top_p,
        )
    if settings.ai_provider_mode == "gemini_dev":
        return GeminiContentProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            timeout_ms=settings.ai_request_timeout_ms,
            temperature=settings.ai_temperature,
            top_p=settings.ai_top_p,
        )
    if settings.ai_provider_mode == "openrouter":
        return OpenRouterContentProvider(
            api_key=settings.open_router_api_key,
            model=settings.open_router_model,
            timeout_seconds=settings.ai_request_timeout_ms / 1000,
            temperature=settings.ai_temperature,
            top_p=settings.ai_top_p,
        )
    if settings.ai_provider_mode == "mock":
        return MockContentProvider()
    raise ProviderConfigError("Unsupported Content provider mode.")
