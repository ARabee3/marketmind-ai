"""Content v2 contracts (issue #187) — owner-first weekly studio.

Mirrors packages/contracts/src/content/v2/*.ts. These models are the frozen
`content-v1`-adjacent v2 surface: editorial profile, CTA library, week/post
plans, owner media library, immutable version metadata, workspace
aggregates, and the internal planner/full-draft AI contracts.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import Field, model_validator

from content_base import ContentChannel, ContentFormat, FrozenModel, UUID
from content_contracts import (
    ContentAsset,
    ContentCtaDestination,
    ContentDecision,
    ContentErrorCode,
    ContentValidationResult,
)
from strategy_contracts import StrategyPlanV2

LanguageMode = Literal["ar-EG", "en", "mixed"]

CONTENT_V2_MIN_POSTS = 3
CONTENT_V2_MAX_POSTS = 5
CONTENT_V2_MEDIA_MAX_BYTES = 10 * 1024 * 1024


class ContentV2Types(FrozenModel):
    contract_version: Literal["content-v2"] = "content-v2"


class ContentEditorialProfileV2(ContentV2Types):
    id: UUID
    content_cycle_id: UUID
    audience_nuance: str = Field(min_length=1)
    voice: str = Field(min_length=1)
    language: LanguageMode
    writing_guardrails: list[str]
    default_visual_guidance: str | None = None
    tone_preset: Literal[
        "recommended",
        "friendly_local",
        "clear_professional",
        "warm_reassuring",
        "direct_confident",
        "custom",
    ] = "recommended"
    length_preset: Literal["concise", "balanced", "detailed"] = "balanced"
    created_at: datetime
    updated_at: datetime


class ContentEditorialProfileUpsertRequest(FrozenModel):
    audience_nuance: str = ""
    voice: str = ""
    language: LanguageMode
    writing_guardrails: list[str]
    default_visual_guidance: str | None = None
    tone_preset: str = "recommended"
    length_preset: str = "balanced"


class ContentCtaLibraryEntryV2(ContentV2Types):
    id: UUID
    content_cycle_id: UUID
    label: str = Field(min_length=1)
    destination: ContentCtaDestination
    campaign_context: str | None = None
    active: bool
    created_at: datetime
    updated_at: datetime


class ContentCtaLibraryEntryInput(FrozenModel):
    label: str = Field(min_length=1)
    destination: ContentCtaDestination
    campaign_context: str | None = None
    active: bool = True


ContentV2MediaKind = Literal["owner_uploaded", "generated_static"]
ContentV2MediaStatus = Literal[
    "queued", "uploading", "ready", "failed", "revoked"
]
ContentV2MediaFailureCode = Literal[
    "CONTENT_MEDIA_TOO_LARGE",
    "CONTENT_MEDIA_TYPE_UNSUPPORTED",
    "CONTENT_MEDIA_MAGIC_BYTE_MISMATCH",
    "CONTENT_MEDIA_DIMENSIONS_INVALID",
    "CONTENT_MEDIA_CHECKSUM_MISMATCH",
    "CONTENT_MEDIA_STORAGE_FAILURE",
]


class ContentMediaLibraryEntryV2(ContentV2Types):
    id: UUID
    business_id: UUID
    content_cycle_id: UUID
    owner_user_id: UUID
    kind: ContentV2MediaKind
    status: ContentV2MediaStatus
    mime_type: str | None = None
    size_bytes: int | None = Field(default=None, ge=0)
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)
    checksum: str | None = None
    storage_key: str | None = None
    failure_code: ContentV2MediaFailureCode | str | None = None
    created_at: datetime
    updated_at: datetime


class ContentMediaReferenceV2(FrozenModel):
    media_id: UUID
    captured_at: datetime


ContentV2PlanSource = Literal["planner", "owner"]
ContentV2PostPlanState = Literal["planned", "generating", "ready", "failed"]
ContentV2WeekPlanState = Literal["draft", "frozen"]


class ContentPostPlanV2(ContentV2Types):
    id: UUID
    content_week_plan_id: UUID
    position: int = Field(ge=1, le=5)
    purpose: str = Field(min_length=1)
    intended_audience: str | None = None
    channel: ContentChannel
    format: ContentFormat
    cta_library_entry_id: UUID | None = None
    owner_instructions: str | None = None
    visual_direction: str | None = None
    selected_media_ids: list[UUID]
    plan_state: ContentV2PostPlanState = "planned"
    source: ContentV2PlanSource
    content_item_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class ContentV2OptimizationGuidanceV1(FrozenModel):
    """Owner-approved copy guidance frozen with one Content V2 week."""

    instruction_id: UUID
    proposal_id: UUID
    approved_decision_id: UUID
    evidence_checksum: str
    format_cohort: Literal["text_post", "static_image_post"]
    change_kind: Literal["hook_style", "cta_wording_style"]
    instruction: str = Field(min_length=1, max_length=2000)


class ContentV2FrozenInput(FrozenModel):
    week_plan_id: UUID
    content_cycle_id: UUID
    week_number: int = Field(ge=1, le=12)
    week_start_date: str
    editorial_profile: ContentEditorialProfileV2
    cta_entries: list[ContentCtaLibraryEntryV2]
    media_entries: list[ContentMediaLibraryEntryV2]
    post_plans: list[ContentPostPlanV2] = Field(min_length=3, max_length=5)
    optimization_guidance: ContentV2OptimizationGuidanceV1 | None = None
    weekly_claim_id: UUID
    frozen_at: datetime

    @model_validator(mode="after")
    def validate_frozen_plan_count(self) -> "ContentV2FrozenInput":
        if not (CONTENT_V2_MIN_POSTS <= len(self.post_plans) <= CONTENT_V2_MAX_POSTS):
            raise ValueError(
                f"frozen post plans must be between {CONTENT_V2_MIN_POSTS} and "
                f"{CONTENT_V2_MAX_POSTS}"
            )
        positions = [plan.position for plan in self.post_plans]
        if positions != list(range(1, len(positions) + 1)):
            raise ValueError("frozen post plans must be ordered 1..N without gaps")
        return self


class ContentWeekPlanV2(ContentV2Types):
    id: UUID
    content_cycle_id: UUID
    week_number: int = Field(ge=1, le=12)
    status: ContentV2WeekPlanState = "draft"
    post_plans: list[ContentPostPlanV2]
    frozen_input: ContentV2FrozenInput | None = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_plan_count(self) -> "ContentWeekPlanV2":
        if len(self.post_plans) > CONTENT_V2_MAX_POSTS:
            raise ValueError(
                f"a week plan may contain at most {CONTENT_V2_MAX_POSTS} post plans"
            )
        if len(self.post_plans) > 0:
            positions = [plan.position for plan in self.post_plans]
            if positions != list(range(1, len(positions) + 1)):
                raise ValueError("post plans must be ordered 1..N without gaps")
        return self


class ContentWeekPlanListResponse(FrozenModel):
    week_plans: list[ContentWeekPlanV2]


ContentV2EditKind = Literal[
    "generated", "owner_direct_edit", "ai_rewrite", "media_update"
]


class ContentVersionEditMetadataV2(FrozenModel):
    edit_kind: ContentV2EditKind
    base_version_id: UUID | None = None
    base_version_checksum: str | None = None
    edited_by_user_id: UUID | None = None
    validation_state: Literal["validated"] = "validated"
    edited_at: datetime


class ContentItemVersionV2(ContentV2Types):
    id: UUID
    content_item_id: UUID
    content_pack_id: UUID
    version: int = Field(ge=1)
    channel: ContentChannel
    format: ContentFormat
    language_mode: LanguageMode
    strategy_trace: dict[str, Any]
    caption_variants: list[dict[str, Any]]
    cta: str | None = None
    hashtags: list[str]
    creative_brief: str
    alt_text: str
    short_video_script: dict[str, Any] | None = None
    recommended_publish_window: dict[str, Any]
    claim_sources: list[dict[str, Any]]
    warnings: list[str]
    blockers: list[str]
    asset_required: bool
    asset_ids: list[UUID]
    generation_provenance: dict[str, Any]
    version_checksum: str
    created_at: datetime
    edit_metadata: ContentVersionEditMetadataV2


class OwnerContentDirectEditRequest(FrozenModel):
    contract_version: Literal["content-v2"] = "content-v2"
    content_item_id: UUID
    base_version_id: UUID
    base_version_checksum: str
    caption_variants: list[dict[str, Any]]
    cta: str | None = None
    hashtags: list[str]
    alt_text: str
    creative_brief: str
    idempotency_key: str


class OwnerContentDirectEditResponse(FrozenModel):
    contract_version: Literal["content-v2"] = "content-v2"
    item_version: ContentItemVersionV2


class ContentCycleV2(ContentV2Types):
    id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision_id: UUID
    profile_version_id: UUID
    status: Literal["active", "paused", "completed"]
    current_week_number: int = Field(ge=1, le=12)
    next_generation_at: datetime | None
    timezone: Literal["Africa/Cairo"]
    pause_reason: str | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ContentPackV2(ContentV2Types):
    id: UUID
    content_cycle_id: UUID
    weekly_claim_id: UUID
    week_number: int = Field(ge=1, le=12)
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision_id: UUID
    profile_version_id: UUID
    week_context_id: UUID
    status: str
    retry_eligible: bool
    item_ids: list[UUID]
    week_plan_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class ContentWeekSummaryV2(FrozenModel):
    week_number: int = Field(ge=1, le=12)
    week_start_date: str
    status: Literal[
        "not_started", "planned", "generating", "failed", "ready", "completed"
    ]
    plan_id: UUID | None = None
    pack_id: UUID | None = None
    publication_candidate_created: bool


class ContentWhyThisWeekV2(FrozenModel):
    focus: str = Field(min_length=1)
    expected_outcome: str = Field(min_length=1)
    measurement_check: str = Field(min_length=1)
    owner_advice: list[str]
    committed_channels: list[ContentChannel] = Field(min_length=1)
    formats: list[ContentFormat] = Field(min_length=1)


class ContentStrategyReferenceV2(FrozenModel):
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision_id: UUID
    plan_goal: str
    plan_language: str


class ContentV2WorkspaceAsset(FrozenModel):
    id: UUID
    kind: Literal["owner_supplied", "generated_static"]
    status: Literal["generating", "ready", "failed", "missing", "blocked"]
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    alt_text: str
    failure_code: str | None = None
    review_required: bool = False
    created_at: datetime


ContentV2ApprovalState = Literal[
    "ready",
    "needs_media",
    "media_generating",
    "media_failed",
    "blocked",
    "approved",
]


class ContentCurrentWeekWorkspaceV2(FrozenModel):
    week_number: int = Field(ge=1, le=12)
    week_start_date: str
    goal: str
    generation_state: Literal[
        "not_started", "planned", "queued", "generating", "ready", "failed"
    ]
    week_plan: dict[str, Any] | None = None
    pack: ContentPackV2 | None = None
    next_generation_at: datetime | None = None
    primary_action: Literal[
        "plan_week",
        "generate",
        "review_pack",
        "retry",
        "regenerate",
        "none",
    ]


class ContentCycleWorkspaceV2(ContentV2Types):
    cycle: ContentCycleV2
    editorial_profile: ContentEditorialProfileV2 | None = None
    editorial_suggestion: ContentEditorialProfileV2 | None = None
    cta_library: list[ContentCtaLibraryEntryV2]
    media_library: list[ContentMediaLibraryEntryV2]
    current_week: ContentCurrentWeekWorkspaceV2
    previous_weeks: list[ContentWeekSummaryV2]
    next_week: ContentWeekSummaryV2 | None = None
    why_this_week: ContentWhyThisWeekV2
    strategy: ContentStrategyReferenceV2
    view_full_strategy_route: str


class ContentPackItemWorkspaceV2(FrozenModel):
    content_item_id: UUID
    plan: ContentPostPlanV2 | None = None
    current_version: ContentItemVersionV2
    versions: list[ContentItemVersionV2]
    decision: ContentDecision | None = None
    assets: list[ContentV2WorkspaceAsset] = []
    approval_state: ContentV2ApprovalState | None = None


class ContentPackWorkspaceV2(ContentV2Types):
    pack: ContentPackV2
    week_number: int = Field(ge=1, le=12)
    week_start_date: str
    editorial_profile: ContentEditorialProfileV2 | None = None
    editorial_suggestion: ContentEditorialProfileV2 | None = None
    media_library: list[ContentMediaLibraryEntryV2] = []
    items: list[ContentPackItemWorkspaceV2]
    publication_candidate: Any | None = None


class ContentPostPlanDraftV2(FrozenModel):
    purpose: str = Field(min_length=1)
    intended_audience: str | None = None
    channel: ContentChannel
    format: ContentFormat
    cta_library_entry_id: UUID | None = None
    owner_instructions: str | None = None
    visual_direction: str | None = None
    selected_media_ids: list[UUID]


class AiContentV2PlanRequest(ContentV2Types):
    week_plan_id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision_id: UUID
    strategy_plan: StrategyPlanV2
    week_number: int = Field(ge=1, le=12)
    editorial_profile: ContentEditorialProfileV2
    cta_library: list[ContentCtaLibraryEntryV2]
    media_library: list[ContentMediaLibraryEntryV2]
    allowed_channels: list[ContentChannel] = Field(min_length=1)
    allowed_formats: list[ContentFormat] = Field(min_length=1)
    language_mode: LanguageMode
    idempotency_key: str


class AiContentV2PlanResponse(ContentV2Types):
    week_plan_id: UUID
    post_plans: list[ContentPostPlanDraftV2] = Field(min_length=3, max_length=5)
    validation: ContentValidationResult

    @model_validator(mode="after")
    def validate_plan_count(self) -> "AiContentV2PlanResponse":
        if not (CONTENT_V2_MIN_POSTS <= len(self.post_plans) <= CONTENT_V2_MAX_POSTS):
            raise ValueError(
                f"planner must produce between {CONTENT_V2_MIN_POSTS} and "
                f"{CONTENT_V2_MAX_POSTS} post plans"
            )
        return self


class ContentGenerationFailureContextV2(FrozenModel):
    """Safe summary from a previous terminal generation run."""

    error_code: ContentErrorCode
    message: str = Field(min_length=1, max_length=2000)


class AiContentV2GenerateRequest(ContentV2Types):
    content_pack_id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision_id: UUID
    strategy_plan: StrategyPlanV2
    business_profile: dict[str, Any]
    frozen_input: ContentV2FrozenInput
    language_mode: LanguageMode
    idempotency_key: str
    prior_failure: ContentGenerationFailureContextV2 | None = None


class AiContentV2GenerateResponse(ContentV2Types):
    content_pack: ContentPackV2
    cycle: ContentCycleV2
    item_versions: list[ContentItemVersionV2]
    validation: ContentValidationResult

    @model_validator(mode="after")
    def validate_item_count(self) -> "AiContentV2GenerateResponse":
        if not (CONTENT_V2_MIN_POSTS <= len(self.item_versions) <= CONTENT_V2_MAX_POSTS):
            raise ValueError(
                f"generation must produce between {CONTENT_V2_MIN_POSTS} and "
                f"{CONTENT_V2_MAX_POSTS} item versions"
            )
        return self


class AiContentV2ReviseRequest(AiContentV2GenerateRequest):
    """Full-draft context plus the read-only base version and revision notes."""

    content_item_id: UUID
    base_item_version: ContentItemVersionV2
    revision_notes: str = Field(min_length=1, max_length=4000)


class AiContentV2ReviseResponse(ContentV2Types):
    item_version: ContentItemVersionV2
    validation: ContentValidationResult
