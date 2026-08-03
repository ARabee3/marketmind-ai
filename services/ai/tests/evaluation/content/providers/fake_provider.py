"""Deterministic fake ContentLLMProvider modes for the #109 eval harness.

These providers stand in for the #108 provider interface without any paid LLM or
network call.  Modes:

* ``normal``        — valid, grounded content pack.
* ``timeout``       — raises a retryable provider error.
* ``failed_image``  — returns a pack where a required static image asset is
                      provider-failed (status ``failed``), never mislabeled as
                      a generated live asset.

Revision is supported in ``normal`` mode and must preserve the locked fields of
the prior item version.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
import uuid

from content_contracts import (
    ContentAsset,
    ContentAssetKind,
    ContentAssetStatus,
    ContentCaptionVariant,
    ContentClaimSource,
    ContentFormat,
    ContentGenerationProvenance,
    ContentItemVersion,
    ContentRecommendedWindow,
    ContentShortVideoScene,
    ContentShortVideoScript,
    ContentStrategyTrace,
)

from app.content.assembler import PromptAssembly
from app.providers.content_provider import (
    ContentLLMProvider,
    ProviderError,
    compute_content_item_checksum,
)
from tests.evaluation.content.schema import ContentEvalCase, ContentProviderMode


#: Asset MIME types used by the fake provider; never hits a real image generator.
ASSET_MIME_TYPES: dict[str, str] = {
    "static_image_post": "image/jpeg",
    "carousel_brief": "image/jpeg",
    "short_video_script": "image/png",
}


class FakeContentProvider(ContentLLMProvider):
    """Deterministic fake provider driven by a ContentEvalCase.

    The provider stores the case so it can reproduce the right sector, language,
    strategy, and week context.  The ``prompt`` argument is still parsed for
    revision calls because the previous item version is carried there.
    """

    name = "fake-content"

    def __init__(self, mode: ContentProviderMode, case: ContentEvalCase) -> None:
        self.mode = mode
        self.case = case
        self._generated_assets: list[ContentAsset] = []

    @property
    def generated_assets(self) -> list[ContentAsset]:
        """Assets produced by the last ``generate_content_pack`` call."""
        return list(self._generated_assets)

    async def generate_content_pack(
        self, prompt: PromptAssembly
    ) -> list[ContentItemVersion]:
        if self.mode == "timeout":
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Simulated provider timeout",
                retryable=True,
            )

        case = self.case
        ctx = _extract_context(prompt)
        channels = case.strategy_snapshot.approved_channels
        formats = case.strategy_snapshot.formats
        count = case.strategy_snapshot.content_count
        language = case.language_mode
        week_number = case.cycle_state.week_number
        theme = ctx.get("theme", f"Week {week_number} focus")
        objective = ctx.get("objective", "engagement")
        pillars = [
            {"pillar_id": p.pillar_id, "name": p.name}
            for p in case.strategy_snapshot.pillars
        ]
        approved_asset_ids = ctx.get("approved_asset_ids", [])
        promotion = ctx.get("promotion")
        must_include = ctx.get("must_include", [])
        cta = ctx.get("cta")
        pack_id = ctx.get("content_pack_id", _uuid(f"{case.case_id}:pack"))
        business_id = ctx.get("business_id", _uuid(f"{case.case_id}:business"))
        strategy_id = ctx.get("strategy_id", _uuid(f"{case.case_id}:strategy"))
        strategy_version = ctx.get("strategy_version", 1)
        strategy_decision_id = ctx.get(
            "strategy_decision_id", _uuid(f"{case.case_id}:strategy_decision")
        )
        profile_version_id = ctx.get(
            "profile_version_id", _uuid(f"{case.case_id}:profile")
        )
        week_start = ctx.get("week_start_date", date.today().isoformat())
        provider_model = prompt.metadata.get("model", "fake-content-model")

        items: list[ContentItemVersion] = []
        all_assets: list[ContentAsset] = []
        for index in range(count):
            channel = channels[index % len(channels)]
            content_format = formats[index % len(formats)]
            item_id = _uuid(f"{case.case_id}:item:{index}")
            item_version_id = _uuid(f"{case.case_id}:item_version:{item_id}")
            item, item_assets = _build_item(
                case_id=case.case_id,
                item_version_id=item_version_id,
                content_item_id=item_id,
                content_pack_id=pack_id,
                channel=channel,
                content_format=content_format,
                language=language,
                week_number=week_number,
                theme=theme,
                objective=objective,
                pillars=pillars,
                index=index,
                approved_asset_ids=approved_asset_ids,
                promotion=promotion,
                must_include=must_include,
                cta=cta,
                week_start_date=week_start,
                provider_name=self.name,
                provider_model=provider_model,
                strategy_id=strategy_id,
                strategy_version=strategy_version,
                strategy_decision_id=strategy_decision_id,
                business_id=business_id,
                profile_version_id=profile_version_id,
            )
            if self.mode == "failed_image":
                item, failed_asset = _inject_failed_image(item, case.case_id)
                if failed_asset is not None:
                    item_assets = [failed_asset]
            items.append(item)
            all_assets.extend(item_assets)
        self._generated_assets = all_assets
        return items

    async def revise_content_item(
        self, prompt: PromptAssembly
    ) -> ContentItemVersion:
        if self.mode == "timeout":
            raise ProviderError(
                "CONTENT_PROVIDER_FAILURE",
                "Simulated provider timeout",
                retryable=True,
            )

        case = self.case
        ctx = _extract_context(prompt)
        previous = ContentItemVersion.model_validate(ctx["previous_item_version_read_only"])
        provider_model = prompt.metadata.get("model", "fake-content-model")
        return _build_revision(
            previous,
            case_id=case.case_id,
            provider_name=self.name,
            provider_model=provider_model,
        )


def _uuid(seed: str) -> str:
    """Deterministic UUID for a seed string."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def _extract_context(prompt: PromptAssembly) -> dict[str, Any]:
    """Best-effort parse of the prompt JSON context.

    If the prompt does not contain the structured context block we fall back to
    the metadata dict, which is enough for the eval harness to drive the provider.
    """
    try:
        payload = prompt.user_prompt.split("\n\n", 1)[1]
        parsed, _ = __import__("json").JSONDecoder().raw_decode(payload)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return prompt.metadata.get("eval_context", {})


def _build_context(
    case: ContentEvalCase,
    policy_fixture: dict[str, Any] | None,
    content_pack_id: str,
    *,
    previous_item_version: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the JSON context used by the fake provider.

    The context is intentionally a reduced subset of the real prompt context;
    it carries only the fields the fake provider needs to build deterministic
    items.
    """
    week_ctx = _week_context_dict(case, policy_fixture)
    strategy = case.strategy_snapshot

    cta = None
    if week_ctx.get("cta_destination"):
        cta_dest = week_ctx["cta_destination"]
        if cta_dest.get("type") != "none":
            value = cta_dest.get("value")
            cta_type = cta_dest.get("type")
            if case.language_mode == "en":
                cta = f"Contact us via {cta_type}: {value}"
            else:
                cta = f"تواصل معنا عبر {cta_type}: {value}"

    promotion = None
    if week_ctx.get("promotion_mode") == "owner_approved" and week_ctx.get("promotion"):
        promotion = week_ctx["promotion"]

    context: dict[str, Any] = {
        "content_pack_id": content_pack_id,
        "business_id": _uuid(f"{case.case_id}:business"),
        "strategy_id": _uuid(f"{case.case_id}:strategy"),
        "strategy_version": 1,
        "strategy_decision_id": _uuid(f"{case.case_id}:strategy_decision"),
        "profile_version_id": _uuid(f"{case.case_id}:profile"),
        "language_mode": case.language_mode,
        "theme": f"Week {case.cycle_state.week_number} {case.sector} focus",
        "objective": "engagement",
        "pillars": [{"pillar_id": p.pillar_id, "name": p.name} for p in strategy.pillars],
        "approved_asset_ids": week_ctx.get("approved_asset_ids", []),
        "promotion": promotion,
        "must_include": week_ctx.get("must_include", []),
        "must_avoid": week_ctx.get("must_avoid", []),
        "cta": cta,
        "week_number": case.cycle_state.week_number,
        "week_start_date": week_ctx.get("week_start_date", date.today().isoformat()),
        "requested_channels": strategy.approved_channels,
        "allowed_formats": strategy.formats,
    }
    if previous_item_version is not None:
        context["previous_item_version_read_only"] = previous_item_version
    return context


def _week_context_dict(
    case: ContentEvalCase, policy_fixture: dict[str, Any] | None
) -> dict[str, Any]:
    """Return a dict of week-context fields for the case."""
    if policy_fixture is not None:
        wc = policy_fixture.get("week_context", {})
        if wc:
            return wc
    next_ctx = case.cycle_state.next_week_context
    if next_ctx is None:
        return {}
    return {
        "promotion_mode": next_ctx.promotion_mode,
        "promotion": (
            {
                "text": next_ctx.promotion_text,
                "terms": next_ctx.promotion_terms,
                "valid_from": next_ctx.valid_from,
                "valid_until": next_ctx.valid_until,
            }
            if next_ctx.promotion_mode == "owner_approved" and next_ctx.promotion_text
            else None
        ),
        "must_include": next_ctx.must_include,
        "must_avoid": next_ctx.must_avoid,
        "approved_asset_ids": next_ctx.approved_asset_ids,
        "cta_destination": {
            "type": next_ctx.cta_destination_type,
            "value": next_ctx.cta_destination_value,
        },
    }


def _caption(
    *,
    locale: str,
    theme: str,
    index: int,
    promotion_text: str | None,
    promotion_terms: list[str],
    must_include: list[str],
    cta: str | None,
) -> str:
    """Deterministic caption text for the fake provider."""
    if locale == "en":
        parts = [f"Content idea {index + 1}: explore {theme}."]
        if promotion_text:
            parts.append(promotion_text)
        if promotion_terms:
            parts.append(f"Terms: {'; '.join(promotion_terms)}")
        parts.extend(must_include)
        if cta:
            parts.append(cta)
        return " ".join(parts)
    parts = [f"فكرة المحتوى {index + 1}: اكتشف {theme}."]
    if promotion_text:
        parts.append(promotion_text)
    if promotion_terms:
        parts.append(f"الشروط: {'؛ '.join(promotion_terms)}")
    parts.extend(must_include)
    if cta:
        parts.append(cta)
    return " ".join(parts)


def _build_item(
    *,
    case_id: str,
    item_version_id: str,
    content_item_id: str,
    content_pack_id: str,
    channel: str,
    content_format: str,
    language: str,
    week_number: int,
    theme: str,
    objective: str,
    pillars: list[dict[str, str]],
    index: int,
    approved_asset_ids: list[str],
    promotion: dict[str, Any] | None,
    must_include: list[str],
    cta: str | None,
    week_start_date: str,
    provider_name: str,
    provider_model: str,
    strategy_id: str,
    strategy_version: int,
    strategy_decision_id: str,
    business_id: str,
    profile_version_id: str,
) -> ContentItemVersion:
    """Build one deterministic ContentItemVersion."""
    contract_language = "ar-EG" if language == "ar" else language
    locale = "en" if language == "en" else "ar"
    promotion_text = promotion.get("text") if promotion else None
    promotion_terms = promotion.get("terms") if promotion else []
    caption_variants: list[ContentCaptionVariant]
    if language == "en":
        caption_variants = [
            ContentCaptionVariant(
                locale="en",
                caption=_caption(
                    locale="en",
                    theme=theme,
                    index=index,
                    promotion_text=promotion_text,
                    promotion_terms=promotion_terms,
                    must_include=must_include,
                    cta=cta,
                ),
                cta=cta,
                hashtags=["#MarketMind", "#SmallBusiness"],
            )
        ]
    elif language == "mixed":
        caption_variants = [
            ContentCaptionVariant(
                locale="en",
                caption=_caption(
                    locale="en",
                    theme=theme,
                    index=index,
                    promotion_text=promotion_text,
                    promotion_terms=promotion_terms,
                    must_include=must_include,
                    cta=cta,
                ),
                cta=cta,
                hashtags=["#MarketMind", "#SmallBusiness"],
            ),
            ContentCaptionVariant(
                locale="ar",
                caption=_caption(
                    locale="ar",
                    theme=theme,
                    index=index,
                    promotion_text=promotion_text,
                    promotion_terms=promotion_terms,
                    must_include=must_include,
                    cta=cta,
                ),
                cta=cta,
                hashtags=["#MarketMind", "#مشروعك"],
            ),
        ]
    else:
        caption_variants = [
            ContentCaptionVariant(
                locale="ar",
                caption=_caption(
                    locale="ar",
                    theme=theme,
                    index=index,
                    promotion_text=promotion_text,
                    promotion_terms=promotion_terms,
                    must_include=must_include,
                    cta=cta,
                ),
                cta=cta,
                hashtags=["#MarketMind", "#مشروعك"],
            )
        ]

    asset_required = content_format in {"static_image_post", "carousel_brief"}
    asset_ids: list[str] = []
    assets: list[ContentAsset] = []
    if asset_required and approved_asset_ids:
        # Treat the first approved asset as owner-supplied if the fixture already
        # provided one; otherwise the fake provider will generate a static asset.
        owner_asset_ids = [a for a in approved_asset_ids if a.startswith("asset-")]
        if owner_asset_ids:
            asset_ids = [owner_asset_ids[0]]
        else:
            asset_ids = approved_asset_ids[:1]

    if asset_required and not asset_ids:
        # No approved asset -> generate a placeholder static asset.
        asset_id = _uuid(f"{case_id}:generated_asset:{item_version_id}")
        asset_ids = [asset_id]
        assets.append(
            _generated_asset(
                asset_id=asset_id,
                item_version_id=item_version_id,
                content_format=content_format,
                provider_name=provider_name,
                provider_model=provider_model,
                failed=False,
            )
        )

    short_video_script: ContentShortVideoScript | None = None
    if content_format == "short_video_script":
        visual_direction = (
            "وجّه الصورة وفق الموجز الإبداعي المعتمد."
            if language != "en"
            else "Show the visual direction from the approved creative brief."
        )
        short_video_script = ContentShortVideoScript(
            hook=f"{theme}: {hook(language, index)}",
            scenes=[
                ContentShortVideoScene(
                    order=1,
                    visual_direction=visual_direction,
                    voiceover=caption_variants[0].caption,
                    on_screen_text=None,
                )
            ],
            closing_cta=cta,
        )

    pillar_count = max(1, len(pillars))
    pillar_ids = [pillars[index % pillar_count]["pillar_id"]]
    strategy_trace = ContentStrategyTrace(
        strategy_id=strategy_id,
        strategy_version=strategy_version,
        week_number=week_number,
        pillar_ids=pillar_ids,
        objective=objective,
        channel=channel,
    )

    blockers: list[str] = []
    if asset_required and not asset_ids:
        blockers.append("CONTENT_ASSET_REQUIRED")

    claim_sources = [
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
    if must_include:
        claim_sources.append(
            ContentClaimSource(
                claim_type="business_fact",
                source_type="week_context",
                source_path="week_context.must_include",
                approved=True,
            )
        )
    if cta:
        claim_sources.append(
            ContentClaimSource(
                claim_type="business_fact",
                source_type="week_context",
                source_path="week_context.cta_destination",
                approved=True,
            )
        )
    if promotion:
        claim_sources.append(
            ContentClaimSource(
                claim_type="promotion",
                source_type="week_context",
                source_path="week_context.promotion",
                approved=True,
            )
        )

    data: dict[str, Any] = {
        "id": item_version_id,
        "contract_version": "content-v1",
        "content_item_id": content_item_id,
        "content_pack_id": content_pack_id,
        "version": 1,
        "channel": channel,
        "format": content_format,
        "language_mode": contract_language,
        "strategy_trace": strategy_trace.model_dump(mode="json"),
        "caption_variants": [v.model_dump(mode="json") for v in caption_variants],
        "cta": cta,
        "hashtags": caption_variants[0].hashtags,
        "creative_brief": (
            f"أنشئ محتوى {content_format} للفكرة {index + 1} بزاوية '{hook(language, index)}' لموضوع: {theme}."
            if language != "en"
            else f"Create {content_format} idea {index + 1} with angle '{hook(language, index)}' for theme: {theme}."
        ),
        "alt_text": (
            f"مرئي للفكرة {index + 1} بزاوية '{hook(language, index)}' عن {theme}"
            if language != "en"
            else f"Visual for idea {index + 1} with angle '{hook(language, index)}': {theme}"
        )[:100],
        "short_video_script": (
            short_video_script.model_dump(mode="json") if short_video_script else None
        ),
        "recommended_publish_window": _publish_window(
            week_start_date, index
        ).model_dump(mode="json"),
        "claim_sources": [c.model_dump(mode="json") for c in claim_sources],
        "warnings": [],
        "blockers": blockers,
        "asset_required": asset_required,
        "asset_ids": asset_ids,
        "generation_provenance": ContentGenerationProvenance(
            generation_run_id=_uuid(f"{case_id}:run:{item_version_id}"),
            provider_name=provider_name,
            provider_model=provider_model,
            generated_at=datetime.now(UTC),
        ).model_dump(mode="json"),
        "version_checksum": "",
        "created_at": datetime.now(UTC),
    }
    item = ContentItemVersion.model_validate(data)
    return item.model_copy(update={"version_checksum": compute_content_item_checksum(item)}), assets


def _generated_asset(
    *,
    asset_id: str,
    item_version_id: str,
    content_format: str,
    provider_name: str,
    provider_model: str,
    failed: bool,
) -> ContentAsset:
    """Build a deterministic generated-static asset."""
    status: ContentAssetStatus = "failed" if failed else "ready"
    failure_code = "CONTENT_PROVIDER_FAILURE" if failed else None
    checksum = None if failed else "0" * 64
    storage_key = (
        None
        if failed
        else f"content/{item_version_id}/generated.{_extension(content_format)}"
    )
    return ContentAsset(
        id=asset_id,
        content_item_version_id=item_version_id,
        kind="generated_static",
        status=status,
        mime_type=ASSET_MIME_TYPES.get(content_format),
        storage_key=storage_key,
        checksum=checksum,
        width=1080,
        height=1080,
        alt_text="Generated visual",
        provider_name=provider_name,
        provider_model=provider_model,
        provider_request_id=_uuid(f"{asset_id}:request"),
        failure_code=failure_code,
        created_at=datetime.now(UTC),
    )


def _inject_failed_image(item: ContentItemVersion, case_id: str) -> ContentItemVersion:
    """Replace a generated static asset with a provider-failed asset.

    This simulates the image-generation provider failing while the text
    generation succeeded.  The asset stays ``generated_static`` kind but is
    explicitly status ``failed`` with a failure code, never mislabeled as ready.
    """
    if not item.asset_required or not item.asset_ids:
        return item, None

    failed_asset_id = _uuid(f"{case_id}:failed_asset:{item.id}")
    failed_asset = _generated_asset(
        asset_id=failed_asset_id,
        item_version_id=str(item.id),
        content_format=str(item.format),
        provider_name="fake-content",
        provider_model="fake-image-model",
        failed=True,
    )
    data = item.model_dump(mode="json")
    data["asset_ids"] = [failed_asset_id]
    data["blockers"] = list({*data.get("blockers", []), "CONTENT_PROVIDER_FAILURE"})
    data["alt_text"] = "Image generation failed"
    new_item = ContentItemVersion.model_validate(data)
    return new_item.model_copy(update={"version_checksum": compute_content_item_checksum(new_item)}), failed_asset


def _build_revision(
    previous: ContentItemVersion,
    *,
    case_id: str,
    provider_name: str,
    provider_model: str,
) -> ContentItemVersion:
    """Create a new item version while preserving the locked fields."""
    data = previous.model_dump(mode="json")
    data["id"] = _uuid(f"{case_id}:revision:{previous.id}")
    data["version"] = previous.version + 1
    data["created_at"] = datetime.now(UTC).isoformat()
    data["generation_provenance"] = ContentGenerationProvenance(
        generation_run_id=_uuid(f"{case_id}:revision_run:{previous.id}"),
        provider_name=provider_name,
        provider_model=provider_model,
        generated_at=datetime.now(UTC),
    ).model_dump(mode="json")
    # Only a cosmetic mutation to the caption to prove a revision occurred;
    # locked fields are left untouched.
    # The fake provider does not mutate the caption text; the only allowed changes
    # are version bump and provenance, so the revision preservation checks stay
    # deterministic and strict.
    item = ContentItemVersion.model_validate(data)
    return item.model_copy(update={"version_checksum": compute_content_item_checksum(item)})


def _publish_window(week_start_date: str, day_offset: int) -> ContentRecommendedWindow:
    """Deterministic publish window for the fake provider."""
    start = datetime.combine(
        datetime.fromisoformat(week_start_date).date(),
        __import__("datetime").time(10, 0),
        tzinfo=__import__("zoneinfo").ZoneInfo("Africa/Cairo"),
    ) + timedelta(days=day_offset)
    return ContentRecommendedWindow(
        starts_at=start,
        ends_at=start + timedelta(hours=2),
        timezone="Africa/Cairo",
    )


def _extension(content_format: str) -> str:
    return "jpg" if content_format in {"static_image_post", "carousel_brief"} else "png"


def hook(language: str, index: int) -> str:
    """Rotating hook phrase for the fake provider."""
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
    hooks = hooks_en if language == "en" else hooks_ar
    return hooks[index % len(hooks)]


def build_generation_prompt(
    case: ContentEvalCase,
    policy_fixture: dict[str, Any] | None,
    content_pack_id: str,
    *,
    model: str = "fake-content-model",
) -> PromptAssembly:
    """Build a PromptAssembly that drives ``FakeContentProvider.generate_content_pack``."""
    context = _build_context(case, policy_fixture, content_pack_id)
    return PromptAssembly(
        system_prompt="You are a deterministic fake content provider.",
        user_prompt=f"Generate content pack.\n\n{__import__('json').dumps(context, ensure_ascii=False, default=str)}",
        metadata={
            "provider_name": "fake-content",
            "model": model,
            "eval_context": context,
        },
    )


def build_revision_prompt(
    case: ContentEvalCase,
    policy_fixture: dict[str, Any] | None,
    previous_item_version: ContentItemVersion,
    content_pack_id: str,
    *,
    model: str = "fake-content-model",
    revision_notes: str = "Make the caption more concise.",
) -> PromptAssembly:
    """Build a PromptAssembly that drives ``FakeContentProvider.revise_content_item``."""
    context = _build_context(
        case,
        policy_fixture,
        content_pack_id,
        previous_item_version=previous_item_version.model_dump(mode="json"),
    )
    return PromptAssembly(
        system_prompt="You are a deterministic fake content provider.",
        user_prompt=(
            "Revise content item.\n\n"
            f"{__import__('json').dumps(context, ensure_ascii=False, default=str)}"
        ),
        metadata={
            "provider_name": "fake-content",
            "model": model,
            "revision_notes": revision_notes,
            "eval_context": context,
        },
    )
