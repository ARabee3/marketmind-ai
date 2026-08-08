"""Deterministic planner-stage validation (Content v2, issue #187)."""

from __future__ import annotations

from content_contracts import (
    ContentValidationIssue,
    ContentValidationResult,
)
from content_v2_contracts import (
    AiContentV2PlanRequest,
    CONTENT_V2_MAX_POSTS,
    CONTENT_V2_MIN_POSTS,
    ContentPostPlanDraftV2,
)


def validate_content_plan_request(
    request: AiContentV2PlanRequest,
) -> ContentValidationResult:
    """Grounding gates before any provider call."""
    issues: list[ContentValidationIssue] = []
    if request.strategy_plan.contract_version != "strategy-v2":
        issues.append(
            ContentValidationIssue(
                code="CONTENT_SCHEMA_FAILURE",
                field="strategy_plan.contract_version",
                message="The planner requires an approved strategy-v2 plan.",
                retryable=False,
            )
        )
    if not request.allowed_channels:
        issues.append(
            ContentValidationIssue(
                code="CONTENT_CHANNEL_MISMATCH",
                field="allowed_channels",
                message="At least one content-supported channel is required.",
                retryable=False,
            )
        )
    if not request.allowed_formats:
        issues.append(
            ContentValidationIssue(
                code="CONTENT_SCHEMA_FAILURE",
                field="allowed_formats",
                message="At least one allowed format is required.",
                retryable=False,
            )
        )
    if not request.editorial_profile.voice.strip():
        issues.append(
            ContentValidationIssue(
                code="CONTENT_SCHEMA_FAILURE",
                field="editorial_profile.voice",
                message="The editorial profile voice is required before planning.",
                retryable=False,
            )
        )
    return ContentValidationResult(valid=not issues, issues=issues)


def validate_generated_plan(
    request: AiContentV2PlanRequest,
    plans: list[ContentPostPlanDraftV2],
) -> ContentValidationResult:
    """Validate the planner output before it is persisted as week-plan cards."""
    issues: list[ContentValidationIssue] = []
    if not CONTENT_V2_MIN_POSTS <= len(plans) <= CONTENT_V2_MAX_POSTS:
        issues.append(
            ContentValidationIssue(
                code="CONTENT_SCHEMA_FAILURE",
                field="post_plans",
                message=(
                    f"The planner must produce between {CONTENT_V2_MIN_POSTS} "
                    f"and {CONTENT_V2_MAX_POSTS} post plans."
                ),
                retryable=True,
            )
        )
    allowed_channels = set(request.allowed_channels)
    allowed_formats = set(request.allowed_formats)
    cta_ids = {entry.id for entry in request.cta_library}
    media_ids = {entry.id for entry in request.media_library}
    for plan in plans:
        if plan.channel not in allowed_channels:
            issues.append(
                ContentValidationIssue(
                    code="CONTENT_CHANNEL_MISMATCH",
                    field="post_plans.channel",
                    message=(
                        f"Channel {plan.channel} is not allowed by the approved "
                        "Strategy v2 handoff."
                    ),
                    retryable=True,
                )
            )
        if plan.format not in allowed_formats:
            issues.append(
                ContentValidationIssue(
                    code="CONTENT_SCHEMA_FAILURE",
                    field="post_plans.format",
                    message=f"Format {plan.format} is not in the allowed formats.",
                    retryable=True,
                )
            )
        if not plan.purpose.strip():
            issues.append(
                ContentValidationIssue(
                    code="CONTENT_SCHEMA_FAILURE",
                    field="post_plans.purpose",
                    message="Every post plan needs a non-empty purpose.",
                    retryable=True,
                )
            )
        if plan.cta_library_entry_id is not None and plan.cta_library_entry_id not in cta_ids:
            issues.append(
                ContentValidationIssue(
                    code="CONTENT_SCHEMA_FAILURE",
                    field="post_plans.cta_library_entry_id",
                    message="The CTA reference is not in the cycle CTA library.",
                    retryable=True,
                )
            )
        for media_id in plan.selected_media_ids:
            if media_id not in media_ids:
                issues.append(
                    ContentValidationIssue(
                        code="CONTENT_SCHEMA_FAILURE",
                        field="post_plans.selected_media_ids",
                        message="A selected media id is not in the cycle media library.",
                        retryable=True,
                    )
                )
    return ContentValidationResult(valid=not issues, issues=issues)
