"""Deterministic Content input and output validation."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable
from typing import Any

from content_contracts import (
    AiContentGenerateRequest,
    ContentAsset,
    ContentErrorCode,
    ContentItemVersion,
    ContentValidationIssue,
    ContentValidationResult,
    validate_content_policy_fixture as validate_frozen_policy_fixture,
)


_BLOCKED_CLAIM_CODES: dict[str, ContentErrorCode] = {
    "price": "CONTENT_UNSUPPORTED_CLAIM",
    "availability": "CONTENT_UNSUPPORTED_CLAIM",
    "superiority": "CONTENT_UNSUPPORTED_CLAIM",
    "testimonial": "CONTENT_UNSUPPORTED_CLAIM",
    "guarantee": "CONTENT_POLICY_VIOLATION",
    "regulated": "CONTENT_POLICY_VIOLATION",
    "branded_sponsored": "CONTENT_POLICY_VIOLATION",
    "competitor_comparison": "CONTENT_UNSUPPORTED_CLAIM",
}


def _issue(
    code: ContentErrorCode,
    field: str,
    message: str,
    *,
    retryable: bool = False,
) -> ContentValidationIssue:
    return ContentValidationIssue(
        code=code,
        field=field,
        message=message,
        retryable=retryable,
    )


def validate_content_generation_request(
    request: AiContentGenerateRequest,
) -> ContentValidationResult:
    """Validate the deterministic grounding boundary before provider calls.

    NestJS remains authoritative for cycle status, ownership, approval, and the
    weekly claim. This validator checks only the immutable snapshot supplied to
    FastAPI and mirrors the frozen TypeScript request policy.
    """
    issues: list[ContentValidationIssue] = []
    plan = request.strategy_plan
    profile = request.business_profile
    context = request.week_context

    if plan.strategy_id != request.strategy_id or plan.version != request.strategy_version:
        issues.append(
            _issue(
                "CONTENT_VERSION_CONFLICT",
                "strategy_plan.version",
                "Generation requires the exact approved Strategy identity and version.",
            )
        )

    if (
        profile.business_id != request.business_id
        or plan.profile_version.business_profile_version_id != profile.id
        or plan.profile_version.version != profile.version
    ):
        issues.append(
            _issue(
                "CONTENT_PROFILE_STALE",
                "business_profile.id",
                "Generation requires the confirmed Business Profile version referenced by Strategy.",
            )
        )

    plan_language = getattr(plan.plan_language, "value", plan.plan_language)
    if plan_language != request.language_mode:
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "language_mode",
                "Generation language must match the approved Strategy language.",
            )
        )

    approved_channels = {scorecard.channel for scorecard in plan.selected_channels}
    if not request.selected_channels or any(
        channel not in approved_channels for channel in request.selected_channels
    ):
        issues.append(
            _issue(
                "CONTENT_CHANNEL_MISMATCH",
                "selected_channels",
                "Generation channels must be selected by the approved Strategy.",
            )
        )

    if not request.allowed_formats:
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "allowed_formats",
                "Generation requires at least one supported Content format.",
            )
        )

    if not 1 <= context.week_number <= 12:
        issues.append(
            _issue(
                "CONTENT_WEEK_OUT_OF_RANGE",
                "week_context.week_number",
                "Content week must be an integer from 1 through 12.",
            )
        )
    elif not any(
        week.week_number == context.week_number for week in plan.content_strategy.weeks
    ):
        issues.append(
            _issue(
                "CONTENT_WEEK_OUT_OF_RANGE",
                "week_context.week_number",
                "Generation week must exist in the approved Strategy roadmap.",
            )
        )

    if context.promotion_mode == "none" and context.promotion is not None:
        issues.append(
            _issue(
                "CONTENT_OFFER_UNAPPROVED",
                "week_context.promotion",
                "A no-promotion context cannot contain promotion details.",
            )
        )
    if context.promotion_mode == "owner_approved" and context.promotion is None:
        issues.append(
            _issue(
                "CONTENT_OFFER_UNAPPROVED",
                "week_context.promotion",
                "An owner-approved promotion context must include promotion details.",
            )
        )
    if context.context_source == "system_defaulted" and context.promotion is not None:
        issues.append(
            _issue(
                "CONTENT_POLICY_VIOLATION",
                "week_context.context_source",
                "System-defaulted context cannot contain an owner promotion.",
            )
        )

    return ContentValidationResult(valid=not issues, issues=issues)


# Keep the shorter name available for service code and tests.
validate_generation_request = validate_content_generation_request


def derive_strategy_pillar_ids(strategy_id: str, count: int) -> list[str]:
    """Derive stable trace IDs because Strategy v1 stores pillars without IDs."""
    return [
        str(uuid.uuid5(uuid.NAMESPACE_URL, f"{strategy_id}:content-pillar:{index + 1}"))
        for index in range(max(1, count))
    ]


def _add_output_issue(
    issues: list[ContentValidationIssue],
    code: ContentErrorCode,
    field: str,
    message: str,
    *,
    retryable: bool = False,
) -> None:
    issues.append(_issue(code, field, message, retryable=retryable))


def _item_text(item: ContentItemVersion) -> str:
    return json.dumps(item.model_dump(mode="json"), ensure_ascii=False)


def _profile_protected_texts(value: Any, key_path: str = "") -> list[str]:
    """Collect protected identity/contact text for explicit mutation checks."""
    if isinstance(value, dict):
        values: list[str] = []
        for key, child in value.items():
            child_path = f"{key_path}.{key}" if key_path else key
            values.extend(_profile_protected_texts(child, child_path))
        return values
    if isinstance(value, list):
        values = []
        for index, child in enumerate(value):
            values.extend(_profile_protected_texts(child, f"{key_path}[{index}]"))
        return values
    protected_keys = (
        "business_name",
        "handle",
        "address",
        "phone",
        "whatsapp",
        "url",
        "website",
    )
    if isinstance(value, str) and any(
        key in key_path.lower() for key in protected_keys
    ):
        return [value] if value.strip() else []
    return []


def _validate_item_against_generation_request(
    request: AiContentGenerateRequest,
    item: ContentItemVersion,
    assets_by_id: dict[str, ContentAsset],
    *,
    protected_text_mutated: bool,
) -> list[ContentValidationIssue]:
    issues: list[ContentValidationIssue] = []
    strategy_week = request.week_context.week_number
    approved_channels = set(request.selected_channels)
    expected_pillars = set(
        derive_strategy_pillar_ids(
            request.strategy_id,
            len(request.strategy_plan.content_strategy.pillars),
        )
    )

    if item.content_pack_id != request.content_pack_id:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.content_pack_id",
            "Every generated item must belong to the requested Content pack.",
        )
    if item.channel not in approved_channels:
        _add_output_issue(
            issues,
            "CONTENT_CHANNEL_MISMATCH",
            "item.channel",
            "Generated item channel must be selected by the approved Strategy.",
        )
    if item.format not in request.allowed_formats:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.format",
            "Generated item format must be in the requested supported formats.",
        )
    if item.language_mode != request.language_mode:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.language_mode",
            "Generated item language must match the approved Strategy language.",
        )
    trace = item.strategy_trace
    if (
        trace.strategy_id != request.strategy_id
        or trace.strategy_version != request.strategy_version
        or trace.week_number != strategy_week
    ):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.strategy_trace",
            "Every item must trace to the exact requested Strategy version and week.",
        )
    if trace.channel != item.channel:
        _add_output_issue(
            issues,
            "CONTENT_CHANNEL_MISMATCH",
            "item.strategy_trace.channel",
            "Item channel must match its Strategy trace channel.",
        )
    if not set(trace.pillar_ids).intersection(expected_pillars):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.strategy_trace.pillar_ids",
            "Every item must trace to at least one supplied Strategy pillar.",
        )

    expected_locale = "en" if request.language_mode == "en" else "ar"
    locales = {variant.locale for variant in item.caption_variants}
    if expected_locale not in locales:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.caption_variants",
            "Caption variants must include the approved owner-facing language.",
        )
    if request.language_mode == "mixed" and not {"ar", "en"}.issubset(locales):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.caption_variants",
            "Mixed-language Content requires Arabic and English caption variants.",
        )

    if not item.creative_brief.strip() or not item.alt_text.strip():
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.creative_brief",
            "Generated items require a creative brief and alt text.",
        )
    if not item.claim_sources:
        _add_output_issue(
            issues,
            "CONTENT_POLICY_VIOLATION",
            "item.claim_sources",
            "Every generated item requires material claim provenance.",
        )

    item_text = _item_text(item)
    profile_texts = _profile_protected_texts(request.business_profile.profile)
    if protected_text_mutated:
        _add_output_issue(
            issues,
            "CONTENT_POLICY_VIOLATION",
            "item.protected_text",
            "Protected owner and business text was mutated by generation.",
        )
    # Protected values may be omitted when irrelevant; if emitted, they must be
    # present byte-for-byte rather than silently translated or rewritten.
    for protected_text in profile_texts:
        if protected_text in item_text:
            continue
        if any(
            token in item_text
            for token in protected_text.split()
            if len(token) >= 4
        ):
            _add_output_issue(
                issues,
                "CONTENT_POLICY_VIOLATION",
                "item.protected_text",
                "A protected owner or business value appears to have been rewritten.",
            )
            break

    for claim in item.claim_sources:
        if claim.claim_type == "promotion":
            if (
                request.week_context.promotion_mode != "owner_approved"
                or request.week_context.promotion is None
                or not claim.approved
            ):
                _add_output_issue(
                    issues,
                    "CONTENT_OFFER_UNAPPROVED",
                    "item.claim_sources",
                    "Promotions require explicit owner-approved weekly context.",
                )
            elif (
                request.week_context.promotion.valid_until
                < item.recommended_publish_window.starts_at
            ):
                _add_output_issue(
                    issues,
                    "CONTENT_OFFER_UNAPPROVED",
                    "week_context.promotion.valid_until",
                    "Expired promotions cannot be carried into generated Content.",
                )
        blocked_code = _BLOCKED_CLAIM_CODES.get(claim.claim_type)
        if blocked_code is not None and not claim.approved:
            _add_output_issue(
                issues,
                blocked_code,
                "item.claim_sources",
                "Unsupported or regulated claims require approved evidence.",
            )

    for asset_id in item.asset_ids:
        asset = assets_by_id.get(asset_id)
        if asset is None:
            _add_output_issue(
                issues,
                "CONTENT_ASSET_REQUIRED",
                "item.asset_ids",
                "Every referenced asset must be supplied for the exact item version.",
            )
        elif asset.content_item_version_id != item.id:
            _add_output_issue(
                issues,
                "CONTENT_VERSION_CONFLICT",
                "item.asset_ids",
                "Every referenced asset must belong to the exact immutable item version.",
            )

    if item.asset_required:
        ready_asset = any(
            asset is not None
            and asset.status == "ready"
            and asset.kind in {"owner_supplied", "generated_static"}
            and asset.storage_key is not None
            and asset.checksum is not None
            for asset in (assets_by_id.get(asset_id) for asset_id in item.asset_ids)
        )
        if not ready_asset:
            _add_output_issue(
                issues,
                "CONTENT_ASSET_REQUIRED",
                "item.asset_ids",
                "Publication-ready media must be a ready owner or generated asset with checksum.",
            )

    return issues


def validate_generated_content_pack(
    request: AiContentGenerateRequest,
    item_versions: Iterable[ContentItemVersion],
    assets: Iterable[ContentAsset] = (),
    *,
    protected_text_mutated: bool = False,
) -> ContentValidationResult:
    """Validate the complete generated pack before it can leave FastAPI."""
    items = list(item_versions)
    issues: list[ContentValidationIssue] = []
    if not 3 <= len(items) <= 5:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item_versions",
            "A generated Content pack must contain between 3 and 5 items.",
        )
    if len({item.id for item in items}) != len(items):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item_versions",
            "A generated Content pack cannot contain duplicate item identities.",
        )
    assets_by_id = {asset.id: asset for asset in assets}
    for index, item in enumerate(items):
        issues.extend(
            _validate_item_against_generation_request(
                request,
                item,
                assets_by_id,
                protected_text_mutated=protected_text_mutated,
            )
        )
        if item.content_item_id == item.id:
            _add_output_issue(
                issues,
                "CONTENT_VERSION_CONFLICT",
                f"item_versions[{index}].content_item_id",
                "The stable item identity must be distinct from and linked to its version identity.",
            )
    return ContentValidationResult(valid=not issues, issues=issues)


def validate_frozen_content_policy_fixture(fixture: dict[str, Any]) -> ContentValidationResult:
    """Expose the reviewed cross-object contract validator to the AI service."""
    return validate_frozen_policy_fixture(fixture)


def validate_revision_item(
    base_item_version: ContentItemVersion,
    revised_item_version: ContentItemVersion,
) -> ContentValidationResult:
    """Ensure revision changes are new versions without changing locked fields."""
    issues: list[ContentValidationIssue] = []

    if revised_item_version.id == base_item_version.id:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.id",
            "A revision must create a new immutable item-version identity.",
        )
    if revised_item_version.version != base_item_version.version + 1:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.version",
            "A revision must create the next immutable item-version number.",
        )

    locked_fields = (
        ("content_item_id", base_item_version.content_item_id, revised_item_version.content_item_id),
        ("content_pack_id", base_item_version.content_pack_id, revised_item_version.content_pack_id),
        ("channel", base_item_version.channel, revised_item_version.channel),
        ("format", base_item_version.format, revised_item_version.format),
        ("language_mode", base_item_version.language_mode, revised_item_version.language_mode),
        (
            "strategy_trace.strategy_id",
            base_item_version.strategy_trace.strategy_id,
            revised_item_version.strategy_trace.strategy_id,
        ),
        (
            "strategy_trace.strategy_version",
            base_item_version.strategy_trace.strategy_version,
            revised_item_version.strategy_trace.strategy_version,
        ),
        (
            "strategy_trace.week_number",
            base_item_version.strategy_trace.week_number,
            revised_item_version.strategy_trace.week_number,
        ),
        (
            "strategy_trace.pillar_ids",
            base_item_version.strategy_trace.pillar_ids,
            revised_item_version.strategy_trace.pillar_ids,
        ),
        (
            "strategy_trace.objective",
            base_item_version.strategy_trace.objective,
            revised_item_version.strategy_trace.objective,
        ),
        (
            "strategy_trace.channel",
            base_item_version.strategy_trace.channel,
            revised_item_version.strategy_trace.channel,
        ),
    )
    for field, base_value, revised_value in locked_fields:
        if revised_value != base_value:
            _add_output_issue(
                issues,
                "CONTENT_VERSION_CONFLICT",
                f"item_version.{field}",
                "Revision cannot change Strategy-locked item fields.",
            )

    if revised_item_version.version_checksum == base_item_version.version_checksum:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.version_checksum",
            "A new revision must have a new version checksum.",
        )
    if (
        revised_item_version.generation_provenance.generation_run_id
        == base_item_version.generation_provenance.generation_run_id
    ):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.generation_provenance.generation_run_id",
            "A revision must record a new generation run identity.",
        )

    return ContentValidationResult(valid=not issues, issues=issues)
