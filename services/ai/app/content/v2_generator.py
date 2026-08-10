"""Content v2 full-draft generation from a frozen snapshot (issue #187).

The worker receives the transactionally frozen plan/profile/CTA/media
snapshot and reuses the proven content-v1 generation pipeline by projecting
it into the v1 request shape. A deterministic plan-alignment validator then
enforces that every generated item matches its frozen post card exactly
(channel, format, count), so generation never drifts from the owner's plan.
"""

from __future__ import annotations

import copy
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from content_contracts import (
    AiContentGenerateRequest,
    AiContentReviseRequest,
    ContentClaimSource,
    ContentCtaDestination,
    ContentItemVersion,
    ContentValidationIssue,
    ContentValidationResult,
    ContentWeekContext,
)
from content_v2_contracts import (
    AiContentV2GenerateRequest,
    AiContentV2GenerateResponse,
    AiContentV2ReviseRequest,
    AiContentV2ReviseResponse,
    ContentItemVersionV2,
    ContentVersionEditMetadataV2,
    ContentPackV2,
    ContentCycleV2,
)
from strategy_contracts import BusinessProfilePayload

from app.content.assembler import (
    assemble_generation_prompt,
    assemble_revision_prompt,
    PromptAssembly,
)
from app.content.circuit_breaker import CircuitBreaker
from app.content.service import (
    generate_content_pack_with_repair,
    revise_content_item_with_repair,
)
from app.content.validators import (
    compute_content_item_checksum,
    is_claim_source_grounded,
    validate_generated_content_pack,
    validate_revision_item,
)
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider

PLAN_ALIGNMENT_RULES = """
## Frozen post-plan alignment (content-v2)

- Produce exactly {plan_count} item versions, one per supplied post_plans card, in the same order.
- Item i must use exactly post_plans[i].channel and post_plans[i].format.
- Ground each item in its card's purpose, owner_instructions, visual_direction, CTA, and selected media.
- When a card selects a CTA, preserve its destination value byte-for-byte in every non-null CTA field. When it does not select a CTA, return null CTA fields.
- Return each hashtag as one array element beginning with # and containing no whitespace. Google Business Profile cards must use an empty hashtag array.
- Include short_video_script only when the card format is short_video_script. Return null for every other format.
- Before returning, remove price, availability, superiority, testimonial, and competitor-comparison wording unless an exact approved grounding value supports it and claim_sources identifies that matching type and source path.
- Do not add, drop, reorder, or merge cards. Do not change a card's channel or format.
"""

_HASHTAG_SEPARATOR = re.compile(r"[\s,،;؛]+")
_ARABIC_LETTER = re.compile(
    r"[\u0600-\u06ff\u0750-\u077f\u0870-\u089f"
    r"\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]"
)
_LATIN_LETTER = re.compile(r"[A-Za-z]")
_MEDIA_FORMATS = {"static_image_post", "carousel_brief"}


def _deterministic_generated_asset_id(content_item_version_id: str) -> str:
    """Mirror the shared TypeScript UUIDv5-compatible asset identity."""
    import hashlib

    digest = bytearray(
        hashlib.sha1(
            bytes.fromhex("6ba7b8119dad11d180b400c04fd430c8")
            + f"content-asset:{content_item_version_id}:generated_static".encode(
                "utf-8"
            )
        ).digest()
    )
    digest[6] = (digest[6] & 0x0F) | 0x50
    digest[8] = (digest[8] & 0x3F) | 0x80
    hex_value = bytes(digest[:16]).hex()
    return (
        f"{hex_value[:8]}-{hex_value[8:12]}-{hex_value[12:16]}-"
        f"{hex_value[16:20]}-{hex_value[20:32]}"
    )


def _generated_asset_fixture(item: ContentItemVersion) -> Any:
    """Represent the deterministic queued visual for the v2 validator."""
    from content_contracts import ContentAsset

    return ContentAsset(
        id=_deterministic_generated_asset_id(item.id),
        content_item_version_id=item.id,
        kind="generated_static",
        status="generating",
        mime_type=None,
        storage_key=None,
        checksum=None,
        width=None,
        height=None,
        alt_text=item.alt_text,
        provider_name=None,
        provider_model=None,
        provider_request_id=None,
        failure_code=None,
        review_required=True,
        created_at=item.created_at,
    )


def _deterministic_week_context_id(frozen_input: Any) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"{frozen_input.content_cycle_id}:week:{frozen_input.week_number}:context",
        )
    )


def v2_generate_to_v1_request(
    request: AiContentV2GenerateRequest,
) -> AiContentGenerateRequest:
    """Project the frozen v2 snapshot into the v1 pipeline's request shape.

    The v1 pipeline consumes a week context; the v2 frozen owner inputs live
    on the post cards, so the synthetic context is deliberately empty of v1
    promotion/instruction fields and carries only identity + dates.
    """
    frozen = request.frozen_input
    handoff = request.strategy_plan.content_handoff
    if not handoff.available:
        raise ValueError(
            "CONTENT_SCHEMA_FAILURE: strategy_plan.content_handoff: "
            "generation requires a usable content handoff."
        )
    handoff_week = next(
        (week for week in handoff.weeks if week.week_number == frozen.week_number),
        None,
    )
    if handoff_week is None:
        raise ValueError(
            "CONTENT_SCHEMA_FAILURE: frozen_input.week_number: "
            "the week is missing from the approved Strategy handoff."
        )
    channels = list({plan.channel for plan in frozen.post_plans})
    if not channels:
        channels = list(handoff.channels)
    formats = list(handoff_week.formats)
    now = datetime.now(timezone.utc)
    context = ContentWeekContext(
        id=_deterministic_week_context_id(frozen),
        contract_version="content-v1",
        content_cycle_id=frozen.content_cycle_id,
        week_number=frozen.week_number,
        week_start_date=frozen.week_start_date,
        promotion_mode="none",
        promotion=None,
        must_include=[],
        must_avoid=[],
        approved_asset_ids=[
            media_id
            for plan in frozen.post_plans
            for media_id in plan.selected_media_ids
        ],
        cta_destination=ContentCtaDestination(type="none", value=None),
        context_source="system_defaulted",
        confirmed_by_user_id=None,
        confirmed_at=None,
        system_defaulted_at=now,
        generation_cutoff_at=now,
        weekly_claim_id=frozen.weekly_claim_id,
    )
    business_profile = BusinessProfilePayload.model_validate(
        request.business_profile
    )
    return AiContentGenerateRequest(
        contract_version="content-v1",
        content_pack_id=request.content_pack_id,
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        strategy_plan=request.strategy_plan,
        business_profile=business_profile,
        week_context=context,
        selected_channels=channels,
        allowed_formats=formats,
        language_mode=request.language_mode,
    )


def assemble_v2_generation_prompt(
    request: AiContentV2GenerateRequest,
    v1_request: AiContentGenerateRequest,
    provider_name: str,
    model: str,
) -> PromptAssembly:
    """Assemble the v1 generation prompt plus frozen post-plan alignment."""
    base = assemble_generation_prompt(v1_request, provider_name, model)
    plan_payloads = [
        plan.model_dump(mode="json") for plan in request.frozen_input.post_plans
    ]
    plan_json = json.dumps(plan_payloads, ensure_ascii=False, indent=2)
    frozen_libraries = {
        "editorial_profile": request.frozen_input.editorial_profile.model_dump(
            mode="json", exclude_none=True
        ),
        "cta_library": [
            entry.model_dump(mode="json", exclude_none=True)
            for entry in request.frozen_input.cta_entries
            if entry.active
        ],
        "media_library": [
            entry.model_dump(mode="json", exclude_none=True)
            for entry in request.frozen_input.media_entries
            if entry.status == "ready"
        ],
    }
    frozen_libraries_json = json.dumps(
        frozen_libraries, ensure_ascii=False, indent=2
    )
    rules = PLAN_ALIGNMENT_RULES.format(plan_count=len(plan_payloads))
    context = copy.deepcopy(base.context)
    context["grounding_inputs"]["post_plans"] = plan_payloads
    context["grounding_inputs"].update(frozen_libraries)
    return PromptAssembly(
        system_prompt=base.system_prompt + "\n\n" + rules,
        user_prompt=(
            base.user_prompt
            + "\n\npost_plans:\n"
            + plan_json
            + "\n\nfrozen_editorial_and_libraries:\n"
            + frozen_libraries_json
        ),
        metadata={
            **base.metadata,
            "contract_version": "content-v2",
            "frozen_input_hash": _sha256(plan_json),
        },
        context=context,
    )


def validate_plan_alignment(
    plans: list[Any],
    items: list[ContentItemVersion],
) -> ContentValidationResult:
    """Enforce one generated item per frozen card with matching channel/format."""
    issues: list[ContentValidationIssue] = []
    if len(items) != len(plans):
        issues.append(
            ContentValidationIssue(
                code="CONTENT_SCHEMA_FAILURE",
                field="item_versions",
                message=(
                    f"Generation produced {len(items)} items for "
                    f"{len(plans)} frozen post plans; the counts must match."
                ),
                retryable=True,
            )
        )
    else:
        for index, (plan, item) in enumerate(zip(plans, items)):
            if item.channel != plan.channel or item.format != plan.format:
                issues.append(
                    ContentValidationIssue(
                        code="CONTENT_CHANNEL_MISMATCH",
                        field=f"item_versions[{index}]",
                        message=(
                            f"Item {index + 1} uses {item.channel}/{item.format} "
                            f"but its frozen card requires "
                            f"{plan.channel}/{plan.format}."
                        ),
                        retryable=True,
                    )
                )
    return ContentValidationResult(valid=not issues, issues=issues)


def _v1_request_for_plan(
    request: AiContentGenerateRequest,
    plan: Any,
    cta_entry: Any | None,
) -> AiContentGenerateRequest:
    """Project one frozen card into the v1 validator's per-item context."""
    destination = (
        cta_entry.destination
        if cta_entry is not None
        else ContentCtaDestination(type="none", value=None)
    )
    week_context = request.week_context.model_copy(
        update={
            "cta_destination": destination,
            "approved_asset_ids": list(plan.selected_media_ids),
        }
    )
    return request.model_copy(
        update={
            "selected_channels": [plan.channel],
            # Keep the complete handoff format list so the v1 request gate
            # remains valid; per-item validation still checks the exact card
            # format through ``validate_plan_alignment``.
            "allowed_formats": list(request.allowed_formats),
            "week_context": week_context,
        }
    )


def _validate_v2_generated_items(
    request: AiContentV2GenerateRequest,
    v1_request: AiContentGenerateRequest,
    items: list[ContentItemVersion],
) -> ContentValidationResult:
    """Run v1 safety checks with each card's own frozen CTA/media boundary."""
    alignment = validate_plan_alignment(request.frozen_input.post_plans, items)
    issues = list(alignment.issues)
    if len(items) == len(request.frozen_input.post_plans):
        cta_by_id = {entry.id: entry for entry in request.frozen_input.cta_entries}
        for plan, item in zip(request.frozen_input.post_plans, items):
            item_request = _v1_request_for_plan(
                v1_request,
                plan,
                cta_by_id.get(plan.cta_library_entry_id),
            )
            item_validation = validate_generated_content_pack(
                item_request,
                [item],
                assets=[_generated_asset_fixture(item)]
                if _deterministic_generated_asset_id(item.id) in item.asset_ids
                else [],
                enforce_asset_readiness=False,
                enforce_item_count=False,
            )
            issues.extend(item_validation.issues)
    return ContentValidationResult(valid=not issues, issues=issues)


def _normalize_v2_finalized_items(
    items: list[ContentItemVersion],
) -> list[ContentItemVersion]:
    """Give media-required cards a deterministic generated visual slot.

    Owner-selected media is preserved for every format, but text-only and
    short-video cards must not acquire an automatic image dependency. NestJS
    queues a generated image only when a media-required card has no selected
    owner asset.
    """
    normalized: list[ContentItemVersion] = []
    for item in items:
        generated_asset_id = _deterministic_generated_asset_id(item.id)
        asset_ids = list(item.asset_ids)
        if item.asset_required and not asset_ids:
            asset_ids = [generated_asset_id]
        blockers = [
            blocker
            for blocker in item.blockers
            if blocker != "CONTENT_ASSET_REQUIRED"
        ]
        staged = item.model_copy(
            update={"asset_ids": asset_ids, "blockers": blockers}
        )
        normalized.append(
            staged.model_copy(
                update={
                    "version_checksum": compute_content_item_checksum(staged)
                }
            )
        )
    return normalized


def _normalize_hashtags(channel: str, values: list[str]) -> list[str]:
    """Repair only hashtag token shape without inventing new topic words."""
    if channel == "google_business_profile":
        return []

    normalized: list[str] = []
    for value in values:
        for fragment in _HASHTAG_SEPARATOR.split(value.strip()):
            for token in fragment.split("#"):
                token = token.strip()
                if not token:
                    continue
                hashtag = f"#{token}"
                if hashtag not in normalized:
                    normalized.append(hashtag)
    return normalized


def _cta_label_for_locale(label: str, locale: str) -> str:
    """Keep an owner label when it fits the variant, else use neutral copy."""
    arabic_letters = len(_ARABIC_LETTER.findall(label))
    latin_letters = len(_LATIN_LETTER.findall(label))
    total_letters = arabic_letters + latin_letters
    expected_letters = arabic_letters if locale == "ar" else latin_letters
    if total_letters and expected_letters / total_letters >= 0.60:
        return label.strip()
    return "تواصل معنا" if locale == "ar" else "Contact us"


def _normalized_cta(cta_entry: Any | None, locale: str) -> str | None:
    """Build truthful CTA copy from the exact frozen label and destination."""
    if cta_entry is None or cta_entry.destination.type == "none":
        return None
    destination = cta_entry.destination.value
    if destination is None or not destination.strip():
        return None
    label = _cta_label_for_locale(cta_entry.label, locale)
    return f"{label}: {destination}"


def _replace_embedded_ctas(
    text: str | None,
    previous_ctas: set[str],
    canonical_cta: str | None,
) -> str | None:
    """Replace a provider CTA copied into caption or script prose."""
    if text is None or canonical_cta is None:
        return text
    repaired = text
    for previous_cta in sorted(previous_ctas, key=len, reverse=True):
        repaired = repaired.replace(previous_cta, canonical_cta)
    return repaired


def _normalized_claim_sources(
    request: AiContentGenerateRequest,
    item: ContentItemVersion,
) -> list[ContentClaimSource]:
    """Keep resolvable model provenance and add stable grounding roots."""
    baseline = [
        ContentClaimSource(
            claim_type="business_fact",
            source_type="profile",
            source_path="business_profile.profile",
            approved=True,
        ),
        ContentClaimSource(
            claim_type="business_fact",
            source_type="strategy",
            source_path="strategy_plan.goal.text",
            approved=True,
        ),
    ]
    destination = request.week_context.cta_destination
    if destination.type != "none" and destination.value:
        baseline.append(
            ContentClaimSource(
                claim_type="business_fact",
                source_type="week_context",
                source_path="week_context.cta_destination",
                approved=True,
            )
        )

    grounded = [
        claim
        for claim in item.claim_sources
        if is_claim_source_grounded(request, claim)
    ]
    normalized: list[ContentClaimSource] = []
    identities: set[tuple[str, str, str]] = set()
    for claim in [*baseline, *grounded]:
        identity = (claim.claim_type, claim.source_type, claim.source_path)
        if identity not in identities:
            identities.add(identity)
            normalized.append(claim)
    return normalized


def _normalize_v2_generated_items(
    request: AiContentV2GenerateRequest,
    v1_request: AiContentGenerateRequest,
    items: list[ContentItemVersion],
) -> list[ContentItemVersion]:
    """Canonicalize provider formatting from each frozen owner-controlled card.

    This touches only fields whose truth is already fixed by the card: CTA,
    hashtag shape, media readiness, and resolvable provenance metadata.
    Captions, claims in prose, channels, formats, and other safety-sensitive
    output continue through the deterministic validators unchanged.
    """
    if len(items) != len(request.frozen_input.post_plans):
        return items

    cta_by_id = {entry.id: entry for entry in request.frozen_input.cta_entries}
    normalized_items: list[ContentItemVersion] = []
    for plan, item in zip(request.frozen_input.post_plans, items):
        cta_entry = cta_by_id.get(plan.cta_library_entry_id)
        item_request = _v1_request_for_plan(v1_request, plan, cta_entry)
        previous_ctas = {
            value
            for value in [
                item.cta,
                *(variant.cta for variant in item.caption_variants),
                (
                    item.short_video_script.closing_cta
                    if item.short_video_script is not None
                    else None
                ),
            ]
            if value
        }
        normalized_variants = []
        for variant in item.caption_variants:
            variant_cta = _normalized_cta(cta_entry, variant.locale)
            normalized_variants.append(
                variant.model_copy(
                    update={
                        "caption": _replace_embedded_ctas(
                            variant.caption,
                            previous_ctas,
                            variant_cta,
                        ),
                        "cta": variant_cta,
                        "hashtags": _normalize_hashtags(
                            item.channel,
                            variant.hashtags,
                        ),
                    }
                )
            )

        primary_cta = (
            normalized_variants[0].cta
            if normalized_variants
            else _normalized_cta(
                cta_entry,
                "en" if item.language_mode == "en" else "ar",
            )
        )
        primary_hashtags = (
            normalized_variants[0].hashtags
            if normalized_variants
            else _normalize_hashtags(item.channel, item.hashtags)
        )
        # The frozen card owns the format. A provider-added script on a
        # non-video card is inert shape noise and can be discarded safely;
        # missing scripts on actual video cards still fail closed below.
        short_video_script = (
            item.short_video_script
            if plan.format == "short_video_script"
            else None
        )
        if short_video_script is not None:
            script_locale = (
                normalized_variants[0].locale
                if normalized_variants
                else ("en" if item.language_mode == "en" else "ar")
            )
            script_cta = _normalized_cta(cta_entry, script_locale)
            short_video_script = short_video_script.model_copy(
                update={
                    "hook": _replace_embedded_ctas(
                        short_video_script.hook,
                        previous_ctas,
                        script_cta,
                    ),
                    "closing_cta": script_cta,
                    "scenes": [
                        scene.model_copy(
                            update={
                                "voiceover": _replace_embedded_ctas(
                                    scene.voiceover,
                                    previous_ctas,
                                    script_cta,
                                ),
                                "on_screen_text": _replace_embedded_ctas(
                                    scene.on_screen_text,
                                    previous_ctas,
                                    script_cta,
                                ),
                            }
                        )
                        for scene in short_video_script.scenes
                    ],
                }
            )

        asset_required = plan.format in _MEDIA_FORMATS
        # A confirmed owner image may accompany any post format. The format
        # controls whether media is mandatory, not whether owner media is
        # allowed.
        asset_ids = list(plan.selected_media_ids)
        blockers = [
            blocker
            for blocker in item.blockers
            if blocker != "CONTENT_ASSET_REQUIRED"
        ]
        if asset_required and not asset_ids:
            blockers.append("CONTENT_ASSET_REQUIRED")

        normalized_items.append(
            item.model_copy(
                update={
                    "caption_variants": normalized_variants,
                    "cta": primary_cta,
                    "hashtags": primary_hashtags,
                    "short_video_script": short_video_script,
                    "asset_required": asset_required,
                    "asset_ids": asset_ids,
                    "blockers": blockers,
                    "claim_sources": _normalized_claim_sources(
                        item_request,
                        item,
                    ),
                }
            )
        )
    return normalized_items


def _frozen_plan_for_item(request: AiContentV2ReviseRequest) -> Any | None:
    """Find the card for a rewrite, tolerating old fixtures without item ids."""
    plans = request.frozen_input.post_plans
    exact = next(
        (plan for plan in plans if plan.content_item_id == request.content_item_id),
        None,
    )
    if exact is not None:
        return exact
    base = request.base_item_version
    return next(
        (
            plan
            for plan in plans
            if plan.channel == base.channel and plan.format == base.format
        ),
        None,
    )


def to_v2_item_version(
    item: ContentItemVersion,
    *,
    edit_kind: str = "generated",
    base_version_id: str | None = None,
    base_version_checksum: str | None = None,
) -> ContentItemVersionV2:
    """Tag a pipeline item version as an immutable validated v2 version."""
    data = item.model_dump(mode="json")
    data["contract_version"] = "content-v2"
    data["edit_metadata"] = ContentVersionEditMetadataV2(
        edit_kind=edit_kind,
        base_version_id=base_version_id,
        base_version_checksum=base_version_checksum,
        edited_by_user_id=None,
        validation_state="validated",
        edited_at=data["created_at"],
    ).model_dump(mode="json")
    return ContentItemVersionV2.model_validate(data)


def to_v1_item_version(item: ContentItemVersionV2) -> ContentItemVersion:
    """Strip v2-only fields back to the v1 pipeline surface."""
    data = item.model_dump(mode="json")
    data["contract_version"] = "content-v1"
    data.pop("edit_metadata", None)
    return ContentItemVersion.model_validate(data)


def _sha256(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def generate_v2_content_pack(
    request: AiContentV2GenerateRequest,
    provider: ContentLLMProvider,
    breaker: CircuitBreaker | None,
) -> AiContentV2GenerateResponse:
    """Run the full-draft worker against the frozen snapshot."""
    v1_request = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(
        request,
        v1_request,
        provider_name=provider.name,
        model=str(getattr(provider, "model", "unknown")),
    )
    items = await generate_content_pack_with_repair(
        provider,
        prompt,
        request=v1_request,
        breaker=breaker,
        request_validator=lambda generation_request, generated: _validate_v2_generated_items(
            request,
            generation_request,
            generated,
        ),
        output_normalizer=lambda generated: _normalize_v2_generated_items(
            request,
            v1_request,
            generated,
        ),
        final_output_normalizer=_normalize_v2_finalized_items,
    )
    validation = _validate_v2_generated_items(request, v1_request, items)
    if not validation.valid:
        issue = validation.issues[0]
        raise ProviderError(
            issue.code,
            f"{issue.field}: {issue.message}",
            retryable=issue.retryable,
        )
    item_versions = [to_v2_item_version(item) for item in items]
    now = datetime.now(timezone.utc)
    frozen = request.frozen_input
    pack = ContentPackV2(
        id=request.content_pack_id,
        contract_version="content-v2",
        content_cycle_id=frozen.content_cycle_id,
        weekly_claim_id=frozen.weekly_claim_id,
        week_number=frozen.week_number,
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        profile_version_id=BusinessProfilePayload.model_validate(
            request.business_profile
        ).id,
        status="draft",
        retry_eligible=False,
        item_ids=[item.content_item_id for item in item_versions],
        week_plan_id=frozen.week_plan_id,
        week_context_id=_deterministic_week_context_id(frozen),
        created_at=now,
        updated_at=now,
    )
    cycle = ContentCycleV2(
        id=frozen.content_cycle_id,
        contract_version="content-v2",
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        profile_version_id=BusinessProfilePayload.model_validate(
            request.business_profile
        ).id,
        status="active",
        current_week_number=frozen.week_number,
        next_generation_at=None,
        timezone="Africa/Cairo",
        pause_reason=None,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )
    return AiContentV2GenerateResponse(
        contract_version="content-v2",
        content_pack=pack,
        cycle=cycle,
        item_versions=item_versions,
        validation=validation,
    )


async def revise_v2_content_item(
    request: AiContentV2ReviseRequest,
    provider: ContentLLMProvider,
    breaker: CircuitBreaker | None,
) -> AiContentV2ReviseResponse:
    """AI rewrite (issue #187): reuse the v1 revision machinery against the
    frozen snapshot, then tag the result as an immutable ai_rewrite version."""
    v1_request = v2_generate_to_v1_request(request)
    plan = _frozen_plan_for_item(request)
    if plan is None:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "The frozen post plan for this content item is missing.",
            retryable=False,
        )
    cta_entry = next(
        (
            entry
            for entry in request.frozen_input.cta_entries
            if entry.id == plan.cta_library_entry_id
        ),
        None,
    )
    v1_request = _v1_request_for_plan(v1_request, plan, cta_entry)
    v1_request = v1_request.model_copy(
        update={
            "week_context": v1_request.week_context.model_copy(
                update={
                    "approved_asset_ids": list(
                        dict.fromkeys(
                            [
                                *v1_request.week_context.approved_asset_ids,
                                *request.base_item_version.asset_ids,
                            ]
                        )
                    )
                }
            )
        }
    )
    v1_base = to_v1_item_version(request.base_item_version)
    v1_revise = AiContentReviseRequest(
        contract_version="content-v1",
        content_pack_id=request.content_pack_id,
        content_item_id=request.content_item_id,
        base_item_version_id=request.base_item_version.id,
        revision_notes=request.revision_notes,
        idempotency_key=request.idempotency_key,
    )
    prompt = assemble_revision_prompt(
        v1_revise,
        v1_base,
        provider_name=provider.name,
        model=str(getattr(provider, "model", "unknown")),
        generation_request=v1_request,
    )
    item = await revise_content_item_with_repair(
        provider,
        prompt,
        base_item_version=v1_base,
        generation_request=v1_request,
        breaker=breaker,
    )
    validation = validate_revision_item(v1_base, item, v1_request)
    if not validation.valid:
        issue = validation.issues[0]
        raise ProviderError(
            issue.code,
            f"{issue.field}: {issue.message}",
            retryable=issue.retryable,
        )
    preserved_asset_ids = list(request.base_item_version.asset_ids)
    revised_blockers = [
        blocker
        for blocker in item.blockers
        if blocker != "CONTENT_ASSET_REQUIRED" or not preserved_asset_ids
    ]
    item = item.model_copy(
        update={
            "asset_ids": preserved_asset_ids,
            "blockers": revised_blockers,
        }
    )
    item = item.model_copy(
        update={"version_checksum": compute_content_item_checksum(item)}
    )
    v2_item = to_v2_item_version(
        item,
        edit_kind="ai_rewrite",
        base_version_id=request.base_item_version.id,
        base_version_checksum=request.base_item_version.version_checksum,
    )
    return AiContentV2ReviseResponse(
        contract_version="content-v2",
        item_version=v2_item,
        validation=validation,
    )
