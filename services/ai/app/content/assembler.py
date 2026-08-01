"""Typed prompt/input assembly for the Content Agent."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
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
from app.content.prompts import (
    CONTENT_ASSET_SYSTEM_PROMPT,
    CONTENT_GENERATE_SYSTEM_PROMPT,
    CONTENT_REVISE_SYSTEM_PROMPT,
    build_asset_user_context,
    build_generate_user_context,
    build_revise_user_context,
)
from app.content.validators import validate_content_generation_request


@dataclass(frozen=True)
class PromptAssembly:
    """A complete provider prompt plus non-sensitive reproducibility metadata."""

    system_prompt: str
    user_prompt: str
    metadata: dict[str, Any]


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _language_value(value: Any) -> str:
    return str(getattr(value, "value", value))


def _raise_for_invalid_generation_request(request: AiContentGenerateRequest) -> None:
    validation = validate_content_generation_request(request)
    if validation.valid:
        return
    first_issue = validation.issues[0]
    raise ValueError(f"{first_issue.code}: {first_issue.field}: {first_issue.message}")


def _generation_metadata(
    request: AiContentGenerateRequest,
    user_prompt: str,
    provider_name: str,
    model: str,
) -> dict[str, Any]:
    """Record identities and hashes without copying private grounding values."""
    return {
        "prompt_version": CONTENT_GENERATE_PROMPT_VERSION,
        "reference_pattern_version": CONTENT_REFERENCE_PATTERN_VERSION,
        "provider_name": provider_name,
        "model": model,
        "contract_version": request.contract_version,
        "assembled_at": datetime.now(timezone.utc).isoformat(),
        "content_pack_id": request.content_pack_id,
        "business_id": request.business_id,
        "strategy_id": request.strategy_id,
        "strategy_version": request.strategy_version,
        "strategy_decision_id": request.strategy_decision_id,
        "profile_version_id": request.business_profile.id,
        "profile_version": request.business_profile.version,
        "content_cycle_id": request.week_context.content_cycle_id,
        "week_number": request.week_context.week_number,
        "weekly_claim_id": request.week_context.weekly_claim_id,
        "language_mode": _language_value(request.language_mode),
        "input_snapshot_hash": _sha256(user_prompt),
    }


def _revision_metadata(
    request: AiContentReviseRequest,
    previous_item_version: ContentItemVersion,
    user_prompt: str,
    provider_name: str,
    model: str,
) -> dict[str, Any]:
    return {
        "prompt_version": CONTENT_REVISE_PROMPT_VERSION,
        "reference_pattern_version": CONTENT_REFERENCE_PATTERN_VERSION,
        "provider_name": provider_name,
        "model": model,
        "contract_version": request.contract_version,
        "assembled_at": datetime.now(timezone.utc).isoformat(),
        "content_pack_id": request.content_pack_id,
        "content_item_id": request.content_item_id,
        "base_item_version_id": request.base_item_version_id,
        "base_item_version": previous_item_version.version,
        "revision_notes_hash": _sha256(request.revision_notes),
        "input_snapshot_hash": _sha256(user_prompt),
    }


def _asset_metadata(
    request: AiStaticAssetGenerateRequest,
    user_prompt: str,
    provider_name: str,
    model: str,
) -> dict[str, Any]:
    return {
        "prompt_version": CONTENT_ASSET_PROMPT_VERSION,
        "provider_name": provider_name,
        "model": model,
        "contract_version": request.contract_version,
        "assembled_at": datetime.now(timezone.utc).isoformat(),
        "content_item_version_id": request.content_item_version_id,
        "dimensions": {"width": request.width, "height": request.height},
        "idempotency_key_hash": _sha256(request.idempotency_key),
        "input_snapshot_hash": _sha256(user_prompt),
    }


def assemble_generation_prompt(
    request: AiContentGenerateRequest,
    provider_name: str,
    model: str,
) -> PromptAssembly:
    """Assemble and validate the exact requested Strategy-week prompt."""
    _raise_for_invalid_generation_request(request)
    user_prompt = build_generate_user_context(request)
    return PromptAssembly(
        system_prompt=CONTENT_GENERATE_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        metadata=_generation_metadata(request, user_prompt, provider_name, model),
    )


def assemble_revision_prompt(
    request: AiContentReviseRequest,
    previous_item_version: ContentItemVersion,
    provider_name: str,
    model: str,
) -> PromptAssembly:
    """Assemble a revision prompt after checking immutable item identity."""
    if previous_item_version.id != request.base_item_version_id:
        raise ValueError(
            "CONTENT_VERSION_CONFLICT: base_item_version_id does not match the supplied item version."
        )
    if (
        previous_item_version.content_pack_id != request.content_pack_id
        or previous_item_version.content_item_id != request.content_item_id
    ):
        raise ValueError(
            "CONTENT_VERSION_CONFLICT: item version does not belong to the requested pack and item."
        )
    if not request.revision_notes.strip():
        raise ValueError("CONTENT_SCHEMA_FAILURE: revision_notes must not be blank.")

    user_prompt = build_revise_user_context(request, previous_item_version)
    return PromptAssembly(
        system_prompt=CONTENT_REVISE_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        metadata=_revision_metadata(
            request,
            previous_item_version,
            user_prompt,
            provider_name,
            model,
        ),
    )


def assemble_asset_prompt(
    request: AiStaticAssetGenerateRequest,
    provider_name: str,
    model: str,
) -> PromptAssembly:
    """Assemble a static-asset prompt with non-sensitive metadata."""
    if request.width <= 0 or request.height <= 0:
        raise ValueError("CONTENT_SCHEMA_FAILURE: asset dimensions must be positive.")
    if not request.creative_brief.strip() or not request.alt_text.strip():
        raise ValueError(
            "CONTENT_SCHEMA_FAILURE: creative_brief and alt_text must not be blank."
        )

    user_prompt = build_asset_user_context(request)
    return PromptAssembly(
        system_prompt=CONTENT_ASSET_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        metadata=_asset_metadata(request, user_prompt, provider_name, model),
    )
