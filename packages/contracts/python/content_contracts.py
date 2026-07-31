from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field, RootModel, model_validator

from content_base import ContentChannel, ContentFormat, FrozenModel, UUID

ContentErrorCode = Literal[
    "CONTENT_STRATEGY_NOT_APPROVED",
    "CONTENT_PROFILE_STALE",
    "CONTENT_CYCLE_PAUSED",
    "CONTENT_CYCLE_COMPLETED",
    "CONTENT_WEEK_OUT_OF_RANGE",
    "CONTENT_WEEK_ALREADY_CLAIMED",
    "CONTENT_CHANNEL_MISMATCH",
    "CONTENT_UNSUPPORTED_CLAIM",
    "CONTENT_OFFER_UNAPPROVED",
    "CONTENT_POLICY_VIOLATION",
    "CONTENT_ASSET_REQUIRED",
    "CONTENT_SCHEMA_FAILURE",
    "CONTENT_VERSION_CONFLICT",
    "CONTENT_APPROVAL_BLOCKED",
    "CONTENT_PROVIDER_FAILURE",
    "CONTENT_CANDIDATE_TAMPERED",
    "CONTENT_CANDIDATE_REVOKED",
]


class ContentValidationIssue(FrozenModel):
    code: ContentErrorCode
    field: str
    message: str
    retryable: bool


class ContentValidationResult(FrozenModel):
    valid: bool
    issues: list[ContentValidationIssue]


LanguageMode = Literal["ar-EG", "en", "mixed"]
ContentAssetKind = Literal["owner_supplied", "generated_static", "prompt_only"]
ContentAssetStatus = Literal["generating", "ready", "missing", "failed", "blocked"]


class ContentCycle(FrozenModel):
    id: UUID
    contract_version: Literal["content-v1"]
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision_id: UUID
    profile_version_id: UUID
    status: Literal["active", "paused", "completed"]
    current_week_number: int = Field(ge=1, le=12)
    next_generation_at: datetime | None
    timezone: Literal["Africa/Cairo"]
    pause_reason: str | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ContentPromotion(FrozenModel):
    text: str
    terms: list[str]
    valid_from: datetime
    valid_until: datetime

    @model_validator(mode="after")
    def validate_range(self) -> "ContentPromotion":
        if self.valid_until < self.valid_from:
            raise ValueError("valid_until must be after valid_from")
        return self


class ContentCtaDestination(FrozenModel):
    type: Literal["phone", "whatsapp", "website", "address", "none"]
    value: str | None


class ContentWeekContext(FrozenModel):
    id: UUID
    contract_version: Literal["content-v1"]
    content_cycle_id: UUID
    week_number: int = Field(ge=1, le=12)
    week_start_date: date
    promotion_mode: Literal["none", "owner_approved"]
    promotion: ContentPromotion | None
    must_include: list[str]
    must_avoid: list[str]
    approved_asset_ids: list[UUID]
    cta_destination: ContentCtaDestination
    confirmed_by_user_id: UUID
    confirmed_at: datetime
    system_defaulted_at: datetime | None
    generation_cutoff_at: datetime
    weekly_claim_id: UUID

    @model_validator(mode="after")
    def validate_promotion_mode(self) -> "ContentWeekContext":
        if self.promotion_mode == "none" and self.promotion is not None:
            raise ValueError("promotion must be null when promotion_mode is none")
        if self.promotion_mode == "owner_approved" and self.promotion is None:
            raise ValueError("promotion is required when owner approved")
        return self


class ContentPack(FrozenModel):
    id: UUID
    contract_version: Literal["content-v1"]
    content_cycle_id: UUID
    weekly_claim_id: UUID
    week_number: int = Field(ge=1, le=12)
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision_id: UUID
    profile_version_id: UUID
    week_context_id: UUID
    status: Literal[
        "queued",
        "generating",
        "validating",
        "draft",
        "partially_approved",
        "approved",
        "failed",
    ]
    retry_eligible: bool
    item_ids: list[UUID] = Field(min_length=3, max_length=5)
    created_at: datetime
    updated_at: datetime


class ContentClaimSource(FrozenModel):
    claim_type: Literal[
        "business_fact",
        "promotion",
        "price",
        "availability",
        "superiority",
        "testimonial",
        "guarantee",
        "regulated",
        "competitor_comparison",
        "branded_sponsored",
    ]
    source_type: Literal["profile", "week_context", "strategy"]
    source_path: str
    approved: bool


class ContentStrategyTrace(FrozenModel):
    strategy_id: UUID
    strategy_version: int
    week_number: int = Field(ge=1, le=12)
    pillar_ids: list[UUID]
    objective: str
    channel: ContentChannel


class ContentCaptionVariant(FrozenModel):
    locale: Literal["ar", "en"]
    caption: str = Field(min_length=1)
    cta: str | None
    hashtags: list[str]


class ContentRecommendedWindow(FrozenModel):
    starts_at: datetime
    ends_at: datetime
    timezone: Literal["Africa/Cairo"]


class ContentGenerationProvenance(FrozenModel):
    generation_run_id: UUID
    provider_name: str
    provider_model: str
    generated_at: datetime


class ContentShortVideoScene(FrozenModel):
    order: int = Field(ge=1)
    visual_direction: str
    voiceover: str | None
    on_screen_text: str | None


class ContentShortVideoScript(FrozenModel):
    hook: str
    scenes: list[ContentShortVideoScene]
    closing_cta: str | None


class ContentAsset(FrozenModel):
    id: UUID
    content_item_version_id: UUID
    kind: ContentAssetKind
    status: ContentAssetStatus
    mime_type: str | None
    storage_key: str | None
    checksum: str | None
    width: int | None
    height: int | None
    alt_text: str = Field(max_length=100)
    provider_name: str | None
    provider_model: str | None
    provider_request_id: str | None
    failure_code: str | None
    created_at: datetime


class ContentItemVersion(FrozenModel):
    id: UUID
    contract_version: Literal["content-v1"]
    content_item_id: UUID
    content_pack_id: UUID
    version: int = Field(ge=1)
    channel: ContentChannel
    format: ContentFormat
    language_mode: LanguageMode
    strategy_trace: ContentStrategyTrace
    caption_variants: list[ContentCaptionVariant] = Field(min_length=1)
    cta: str | None
    hashtags: list[str]
    creative_brief: str
    alt_text: str = Field(max_length=100)
    short_video_script: ContentShortVideoScript | None
    recommended_publish_window: ContentRecommendedWindow
    claim_sources: list[ContentClaimSource]
    warnings: list[str]
    blockers: list[str]
    asset_required: bool
    asset_ids: list[UUID]
    generation_provenance: ContentGenerationProvenance
    version_checksum: str
    created_at: datetime

    @model_validator(mode="after")
    def validate_alt_text(self) -> "ContentItemVersion":
        if self.asset_required and not self.alt_text.strip():
            raise ValueError("asset_required versions need alt_text")
        return self


class ContentDecision(FrozenModel):
    id: UUID
    content_item_id: UUID
    content_item_version_id: UUID
    content_item_version: int = Field(ge=1)
    content_item_version_checksum: str
    decision: Literal["approved", "rejected", "revision_requested"]
    revision_notes: str | None
    decided_by_user_id: UUID
    decided_at: datetime

    @model_validator(mode="after")
    def validate_revision_notes(self) -> "ContentDecision":
        if self.decision == "revision_requested" and not self.revision_notes:
            raise ValueError("revision notes are required")
        return self


class WeeklyClaim(FrozenModel):
    content_cycle_id: UUID
    week_number: int = Field(ge=1, le=12)
    weekly_claim_id: UUID


class ContentPolicyFixture(FrozenModel):
    strategy_status: Literal["approved", "draft", "rejected"]
    strategy_id: UUID
    strategy_version: int
    cycle_status: Literal["active", "paused", "completed"] | None = None
    profile_version_id: UUID
    current_profile_version_id: UUID
    selected_channels: list[ContentChannel]
    existing_weekly_claims: list[WeeklyClaim]
    week_context: ContentWeekContext
    pack: ContentPack
    item_version: ContentItemVersion
    assets: list[ContentAsset]
    decision: ContentDecision | None = None
    protected_text_mutated: bool | None = None


from content_publication_contracts import (  # noqa: E402
    PublicationCandidateCreatedEventV1,
    PublicationCandidateV1,
)


class AiContentGenerateRequest(FrozenModel):
    contract_version: Literal["content-v1"]
    content_pack_id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    week_context: ContentWeekContext
    selected_channels: list[ContentChannel]
    allowed_formats: list[ContentFormat]
    language_mode: LanguageMode


class AiContentGenerateResponse(FrozenModel):
    contract_version: Literal["content-v1"]
    content_pack: ContentPack
    item_versions: list[ContentItemVersion]
    validation: ContentValidationResult


class AiContentReviseRequest(FrozenModel):
    contract_version: Literal["content-v1"]
    content_pack_id: UUID
    content_item_id: UUID
    base_item_version_id: UUID
    revision_notes: str
    idempotency_key: str


class AiContentReviseResponse(FrozenModel):
    contract_version: Literal["content-v1"]
    item_version: ContentItemVersion
    validation: ContentValidationResult


class AiStaticAssetGenerateRequest(FrozenModel):
    contract_version: Literal["content-v1"]
    content_item_version_id: UUID
    creative_brief: str
    alt_text: str
    width: int
    height: int
    idempotency_key: str


class AiStaticAssetGenerateResponse(FrozenModel):
    contract_version: Literal["content-v1"]
    asset: ContentAsset
    validation: ContentValidationResult


ContentFixture = RootModel[
    ContentCycle
    | ContentWeekContext
    | ContentPack
    | ContentItemVersion
    | ContentDecision
    | ContentPolicyFixture
    | PublicationCandidateCreatedEventV1
]


def _is_week_in_range(week_number: int) -> bool:
    return isinstance(week_number, int) and 1 <= week_number <= 12


def _promotion_expired(week_context: dict, item_version: dict) -> bool:
    promotion = week_context.get("promotion")
    if promotion is None:
        return False
    return datetime.fromisoformat(promotion["valid_until"]) < datetime.fromisoformat(
        item_version["recommended_publish_window"]["starts_at"]
    )


def _has_ready_publishable_asset(fixture: dict) -> bool:
    assets_by_id = {asset["id"]: asset for asset in fixture["assets"]}
    for asset_id in fixture["item_version"]["asset_ids"]:
        asset = assets_by_id.get(asset_id)
        if (
            asset is not None
            and asset["status"] == "ready"
            and asset["kind"] in ("owner_supplied", "generated_static")
            and asset["checksum"] is not None
            and asset["storage_key"] is not None
        ):
            return True
    return False


BLOCKED_CLAIM_CODES = {
    "price": "CONTENT_UNSUPPORTED_CLAIM",
    "availability": "CONTENT_UNSUPPORTED_CLAIM",
    "superiority": "CONTENT_UNSUPPORTED_CLAIM",
    "testimonial": "CONTENT_UNSUPPORTED_CLAIM",
    "guarantee": "CONTENT_POLICY_VIOLATION",
    "regulated": "CONTENT_POLICY_VIOLATION",
    "branded_sponsored": "CONTENT_POLICY_VIOLATION",
    "competitor_comparison": "CONTENT_UNSUPPORTED_CLAIM",
}


def validate_content_policy_fixture(fixture: dict) -> ContentValidationResult:
    issues: list[ContentValidationIssue] = []

    def add_issue(
        code: str, field: str, message: str, retryable: bool = False
    ) -> None:
        issues.append(
            ContentValidationIssue(
                code=code, field=field, message=message, retryable=retryable
            )
        )

    week_context = fixture["week_context"]
    pack = fixture["pack"]
    item_version = fixture["item_version"]
    decision = fixture.get("decision")
    cycle_status = fixture.get("cycle_status")

    if cycle_status == "paused":
        add_issue(
            "CONTENT_CYCLE_PAUSED",
            "cycle_status",
            "Generation is blocked while the content cycle is paused.",
        )
    if cycle_status == "completed":
        add_issue(
            "CONTENT_CYCLE_COMPLETED",
            "cycle_status",
            "Generation is blocked after the content cycle completes.",
        )
    if fixture["strategy_status"] != "approved":
        add_issue(
            "CONTENT_STRATEGY_NOT_APPROVED",
            "strategy_status",
            "Content requires an exact owner-approved Strategy version.",
        )
    if (
        fixture["profile_version_id"] != fixture["current_profile_version_id"]
        or pack["profile_version_id"] != fixture["profile_version_id"]
    ):
        add_issue(
            "CONTENT_PROFILE_STALE",
            "profile_version_id",
            "Content profile version must match the approved Strategy profile version.",
        )
    if not _is_week_in_range(week_context["week_number"]):
        add_issue(
            "CONTENT_WEEK_OUT_OF_RANGE",
            "week_context.week_number",
            "Content week must be an integer from 1 through 12.",
        )
    if any(
        claim["content_cycle_id"] == week_context["content_cycle_id"]
        and claim["week_number"] == week_context["week_number"]
        and claim["weekly_claim_id"] != pack["weekly_claim_id"]
        for claim in fixture["existing_weekly_claims"]
    ):
        add_issue(
            "CONTENT_WEEK_ALREADY_CLAIMED",
            "week_context.weekly_claim_id",
            "A content cycle can claim a Strategy week only once.",
        )
    if item_version["channel"] not in fixture["selected_channels"]:
        add_issue(
            "CONTENT_CHANNEL_MISMATCH",
            "item_version.channel",
            "Content item channel must be selected by the approved Strategy.",
        )
    claim_sources = item_version["claim_sources"]
    if any(
        claim["claim_type"] == "promotion" and not claim["approved"]
        for claim in claim_sources
    ) or (
        week_context["promotion_mode"] != "owner_approved"
        and any(claim["claim_type"] == "promotion" for claim in claim_sources)
    ):
        add_issue(
            "CONTENT_OFFER_UNAPPROVED",
            "item_version.claim_sources",
            "Promotions must come from explicit owner-approved weekly context.",
        )
    if _promotion_expired(week_context, item_version):
        add_issue(
            "CONTENT_OFFER_UNAPPROVED",
            "week_context.promotion.valid_until",
            "Expired promotions cannot be carried into generated content.",
        )
    for claim in claim_sources:
        code = BLOCKED_CLAIM_CODES.get(claim["claim_type"])
        if code is not None and not claim["approved"]:
            add_issue(
                code,
                "item_version.claim_sources",
                "Unsupported, regulated, testimonial, guarantee, or competitor claims need approved evidence before Content approval.",
            )
    if fixture.get("protected_text_mutated") is True:
        add_issue(
            "CONTENT_POLICY_VIOLATION",
            "protected_text_mutated",
            "Protected owner/business text must not be silently rewritten.",
        )
    if item_version["asset_required"] and not _has_ready_publishable_asset(fixture):
        add_issue(
            "CONTENT_ASSET_REQUIRED",
            "item_version.asset_ids",
            "Publication-ready content requires a ready owner-supplied or generated static asset.",
        )
    if not (3 <= len(pack["item_ids"]) <= 5):
        add_issue(
            "CONTENT_SCHEMA_FAILURE",
            "pack.item_ids",
            "A content pack must reference between 3 and 5 content items.",
        )
    if item_version["asset_required"] and any(
        asset["status"] == "failed"
        and asset["id"] in item_version["asset_ids"]
        for asset in fixture["assets"]
    ):
        add_issue(
            "CONTENT_PROVIDER_FAILURE",
            "item_version.asset_ids",
            "Required asset generation failed and cannot be published.",
        )
    if (
        decision is not None
        and decision["decision"] == "approved"
        and item_version["asset_required"]
        and not _has_ready_publishable_asset(fixture)
    ):
        add_issue(
            "CONTENT_APPROVAL_BLOCKED",
            "item_version.asset_ids",
            "Content approval cannot produce a candidate until required assets are ready.",
        )
    if not item_version["alt_text"].strip():
        add_issue(
            "CONTENT_ASSET_REQUIRED",
            "item_version.alt_text",
            "Image-bearing Content requires non-empty alt text.",
        )
    elif len(item_version["alt_text"]) > 100:
        add_issue(
            "CONTENT_SCHEMA_FAILURE",
            "item_version.alt_text",
            "Alt text must not exceed 100 characters (platform alt-text limit).",
        )
    if (
        decision is not None
        and decision["decision"] == "approved"
        and (
            decision["content_item_version_id"] != item_version["id"]
            or decision["content_item_version_checksum"]
            != item_version["version_checksum"]
        )
    ):
        add_issue(
            "CONTENT_VERSION_CONFLICT",
            "decision.content_item_version_id",
            "Approval must reference the exact immutable Content item version and checksum.",
        )

    return ContentValidationResult(valid=len(issues) == 0, issues=issues)
