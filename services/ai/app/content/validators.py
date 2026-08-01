"""Deterministic Content input and output validation."""

from __future__ import annotations

from content_contracts import (
    AiContentGenerateRequest,
    ContentErrorCode,
    ContentValidationIssue,
    ContentValidationResult,
)


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
