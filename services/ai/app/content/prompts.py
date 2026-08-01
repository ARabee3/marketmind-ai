"""Versioned Content generation, revision, and asset prompts."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from content_contracts import (
    AiContentGenerateRequest,
    AiContentReviseRequest,
    AiStaticAssetGenerateRequest,
    ContentItemVersion,
)

from app.content.prompt_versions import (
    CONTENT_ASSET_PROMPT_VERSION,
    CONTENT_GENERATE_PROMPT_VERSION,
    CONTENT_REFERENCE_PATTERN_VERSION,
    CONTENT_REVISE_PROMPT_VERSION,
)


_SENSITIVE_KEY_PARTS = (
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "token",
)


CONTENT_GENERATE_SYSTEM_PROMPT = "\n".join(
    [
        "You are the MarketMind Content Agent.",
        f"Prompt version: {CONTENT_GENERATE_PROMPT_VERSION}.",
        f"Reference pattern version: {CONTENT_REFERENCE_PATTERN_VERSION}.",
        "",
        "Your job: generate one grounded draft ContentPack for the exact requested Strategy week.",
        "NestJS chooses the week and owns lifecycle, approval, scheduling, and publishing.",
        "You must not advance the cycle, choose another week, approve, schedule, or publish.",
        "",
        "## Grounding rules",
        "",
        "- Use only the supplied immutable Strategy plan, confirmed Business Profile, weekly context, and approved asset IDs.",
        "- Tie every item to the supplied Strategy week, at least one Strategy pillar, and a selected channel.",
        "- Generate exactly 3-5 items and use only the requested channels and supported formats.",
        "- Record a claim source for every material business, owner, promotion, or Strategy claim.",
        "- Never use model memory, live web research, competitor research, or a new RAG run as a source.",
        "- If a required fact is missing, expose the missing input or blocker; do not fill it from memory.",
        "",
        "## Forbidden claims and behavior",
        "",
        "- Never invent offers, prices, discounts, opening hours, availability, testimonials, guarantees, or business facts.",
        "- Never create medical outcomes, legal claims, competitor comparisons, superiority claims, or sponsored claims without supplied approval.",
        "- Use promotion text and terms exactly as supplied when promotion_mode is owner_approved.",
        "- When promotion_mode is none or context_source is system_defaulted, do not include a promotion.",
        "- Preserve protected text such as names, handles, addresses, URLs, owner text, and approved offer terms exactly; never silently translate it.",
        "- Do not present prompt-only, missing, blocked, or provider-unavailable media as a generated ready asset.",
        "",
        "## Required output",
        "",
        "Return only valid JSON matching the supplied content-v1 item-version shape.",
        "Return 3-5 complete ContentItemVersion objects, including caption variants, CTA, hashtags, creative brief, alt text,",
        "recommended Africa/Cairo posting window, claim_sources, warnings/blockers, generation provenance, and version checksum.",
        "Include a short-video script when the requested format requires it; do not generate video bytes.",
        "The result is always a draft and must never contain an approval or publishing decision.",
        "",
        "## Language behavior",
        "",
        "- ar-EG: write owner-facing prose in Egyptian-friendly Arabic while preserving protected text exactly.",
        "- en: write owner-facing prose in English while preserving protected text exactly.",
        "- mixed: preserve each supplied text's intended language/script; do not silently translate protected text.",
        "",
        "Return only the structured JSON requested by the caller.",
    ]
)


CONTENT_REVISE_SYSTEM_PROMPT = "\n".join(
    [
        "You are the MarketMind Content Agent revising one draft item.",
        f"Prompt version: {CONTENT_REVISE_PROMPT_VERSION}.",
        f"Reference pattern version: {CONTENT_REFERENCE_PATTERN_VERSION}.",
        "",
        "Create one new immutable ContentItemVersion from explicit owner revision notes.",
        "The previous item version is read-only and must remain available if revision fails.",
        "",
        "## Immutable fields",
        "",
        "Preserve content_item_id, content_pack_id, channel, format, language_mode, Strategy ID/version,",
        "week number, pillar IDs, objective, and Strategy trace channel exactly.",
        "Do not change Strategy decisions, selected channels, promotion approval, or asset ownership.",
        "",
        "## Revision safety",
        "",
        "Apply only explicit owner notes. Do not invent business facts, offers, prices, availability, testimonials,",
        "guarantees, medical outcomes, legal claims, competitor facts, or timely information.",
        "Preserve protected names, handles, addresses, URLs, owner text, and approved offer terms exactly.",
        "Do not approve, schedule, publish, or imply that the revised item is approved.",
        "",
        "Return only one valid content-v1 ContentItemVersion JSON object.",
    ]
)


CONTENT_ASSET_SYSTEM_PROMPT = "\n".join(
    [
        "You are the MarketMind static-creative asset assistant.",
        f"Prompt version: {CONTENT_ASSET_PROMPT_VERSION}.",
        "",
        "Create only the requested eligible static-image asset or an explicit safe failure state.",
        "Use the supplied creative brief and alt text; do not invent business facts, offers, people, products, or claims.",
        "A provider URL is not an authoritative asset reference. Ready assets require storage-port provenance,",
        "an immutable storage key, and a checksum. Provider failure must remain failed or prompt_only, never fake generated_static.",
        "Never approve, schedule, publish, or imply approval.",
    ]
)


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def _redact_sensitive(value: Any, key: str = "") -> Any:
    """Remove credential-like values while preserving business grounding fields."""
    if key and _is_sensitive_key(key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {
            str(child_key): _redact_sensitive(child_value, str(child_key))
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [_redact_sensitive(item) for item in value]
    return value


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)


def _format_profile(request: AiContentGenerateRequest) -> dict[str, Any]:
    data = request.business_profile.model_dump(mode="json", exclude_none=True)
    return _redact_sensitive(data)


def _format_strategy_week(request: AiContentGenerateRequest) -> dict[str, Any]:
    week_number = request.week_context.week_number
    week = next(
        week for week in request.strategy_plan.content_strategy.weeks
        if week.week_number == week_number
    )
    return {
        "week": week.model_dump(mode="json", exclude_none=True),
        "theme": week.theme,
        "objective": str(
            getattr(request.strategy_plan.primary_objective, "value", request.strategy_plan.primary_objective)
        ),
        "pillars": [
            pillar.model_dump(mode="json", exclude_none=True)
            for pillar in request.strategy_plan.content_strategy.pillars
        ],
        "selected_channels": [
            scorecard.model_dump(mode="json", exclude_none=True)
            for scorecard in request.strategy_plan.selected_channels
        ],
        "tone": request.strategy_plan.tone.model_dump(mode="json", exclude_none=True),
        "weekly_cadence": request.strategy_plan.content_strategy.weekly_cadence,
        "experiments": [
            experiment.model_dump(mode="json", exclude_none=True)
            for experiment in request.strategy_plan.content_strategy.experiments
        ],
    }


def build_generate_user_context(request: AiContentGenerateRequest) -> str:
    """Build a grounded generation context with exact week identity."""
    context = {
        "turn_instruction": (
            "Generate a draft for this exact Strategy week only. Do not advance the cycle."
        ),
        "generation_identity": {
            "contract_version": request.contract_version,
            "content_pack_id": request.content_pack_id,
            "business_id": request.business_id,
            "strategy_id": request.strategy_id,
            "strategy_version": request.strategy_version,
            "strategy_decision_id": request.strategy_decision_id,
            "week_number": request.week_context.week_number,
            "language_mode": request.language_mode,
        },
        "grounding_inputs": {
            "strategy_week": _format_strategy_week(request),
            "strategy_profile_reference": request.strategy_plan.profile_version.model_dump(
                mode="json"
            ),
            "business_profile": _format_profile(request),
            "weekly_context": request.week_context.model_dump(
                mode="json", exclude_none=True
            ),
            "requested_channels": request.selected_channels,
            "allowed_formats": request.allowed_formats,
        },
        "output_contract": {
            "contract_version": "content-v1",
            "item_count": {"minimum": 3, "maximum": 5},
            "required_fields": [
                "channel",
                "format",
                "language_mode",
                "strategy_trace",
                "caption_variants",
                "cta",
                "hashtags",
                "creative_brief",
                "alt_text",
                "recommended_publish_window",
                "claim_sources",
                "generation_provenance",
                "version_checksum",
            ],
        },
    }
    return (
        "Content generation context follows. Treat the Strategy week, confirmed Business "
        "Profile, and weekly owner context as separate immutable grounding sources.\n\n"
        f"{_json(context)}"
    )


def build_revise_user_context(
    request: AiContentReviseRequest,
    previous_item_version: ContentItemVersion,
) -> str:
    """Build a revision context with the previous version as read-only input."""
    context = {
        "turn_instruction": (
            "Revise this exact item from the owner's notes and return a new immutable version."
        ),
        "revision_identity": {
            "contract_version": request.contract_version,
            "content_pack_id": request.content_pack_id,
            "content_item_id": request.content_item_id,
            "base_item_version_id": request.base_item_version_id,
            "idempotency_key": request.idempotency_key,
        },
        "previous_item_version_read_only": previous_item_version.model_dump(
            mode="json"
        ),
        "owner_revision_notes": request.revision_notes,
        "locked_fields": [
            "content_item_id",
            "content_pack_id",
            "channel",
            "format",
            "language_mode",
            "strategy_trace.strategy_id",
            "strategy_trace.strategy_version",
            "strategy_trace.week_number",
            "strategy_trace.pillar_ids",
            "strategy_trace.objective",
            "strategy_trace.channel",
        ],
        "output_contract": {"contract_version": "content-v1"},
    }
    return (
        "Content revision context follows. The previous item version is read-only; "
        "preserve all locked fields exactly.\n\n"
        f"{_json(context)}"
    )


def build_asset_user_context(request: AiStaticAssetGenerateRequest) -> str:
    """Build a static-image generation context without provider credentials."""
    context = {
        "turn_instruction": "Generate one eligible static image from this creative brief.",
        "asset_identity": {
            "contract_version": request.contract_version,
            "content_item_version_id": request.content_item_version_id,
            "idempotency_key": request.idempotency_key,
        },
        "creative_brief": request.creative_brief,
        "alt_text": request.alt_text,
        "dimensions": {"width": request.width, "height": request.height},
        "output_contract": {
            "kind": "generated_static",
            "required_provenance": [
                "provider_name",
                "provider_model",
                "provider_request_id",
            ],
            "storage_authority": "asset-storage-port",
        },
    }
    return (
        "Static asset generation context follows. Preserve the supplied creative brief "
        "and alt text; storage is authoritative outside the provider.\n\n"
        f"{_json(context)}"
    )
