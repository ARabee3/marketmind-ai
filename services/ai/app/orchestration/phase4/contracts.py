"""Typed, JSON-safe contracts for the isolated Phase 4 Content graph."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from content_base import FrozenModel
from content_contracts import (
    AiContentGenerateRequest,
    ContentItemVersion,
    ContentPack,
    ContentValidationResult,
)
from orchestration_contracts import (
    CampaignOrchestrationStartV1,
    SHA256,
    StrategyDecisionBindingV1,
    UUID,
)


class Phase4InputV1(FrozenModel):
    """Exact approved Strategy snapshot and Week-1 Content request."""

    contract_version: Literal["phase4-input-v1"]
    start: CampaignOrchestrationStartV1
    strategy_decision: StrategyDecisionBindingV1
    content_request: AiContentGenerateRequest


class StrategyContentHandoffV1(FrozenModel):
    """Immutable boundary from the approved Strategy to Content generation."""

    contract_version: Literal["strategy-content-handoff-v1"]
    run_id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision: StrategyDecisionBindingV1
    content_request: AiContentGenerateRequest


class PreparedPhase4InputV1(FrozenModel):
    """Validated Phase 4 input plus its explicit typed handoff."""

    contract_version: Literal["prepared-phase4-input-v1"]
    start: CampaignOrchestrationStartV1
    handoff: StrategyContentHandoffV1


class ContentQualityReviewV1(FrozenModel):
    """Compact deterministic review; no hidden model reasoning is retained."""

    contract_version: Literal["content-quality-review-v1"]
    artifact_type: Literal["content_pack"]
    valid: bool
    issue_code: str | None = None
    field: str | None = None
    severity: Literal["info", "warning", "blocking"]
    repairable: bool
    short_explanation: str = Field(min_length=1, max_length=500)
    recommended_node: Literal["content", "owner", "terminal"]


class ContentApprovalInterruptV1(FrozenModel):
    """Persistence handoff and exact item decision interrupt payload."""

    kind: Literal["content_approval"]
    run_id: UUID
    business_id: UUID
    owner_user_id: UUID
    strategy_id: UUID
    content_cycle_id: UUID
    content_pack_id: UUID
    content_item_id: UUID
    content_item_version_id: UUID
    content_item_version: int = Field(ge=1)
    content_item_version_checksum: SHA256
    message: str = Field(min_length=1, max_length=300)
    persistence_required: bool = True


class ContentPackPersistenceReceiptV1(FrozenModel):
    """Nest receipt binding the draft pack/item to authoritative persistence."""

    kind: Literal["content_pack_persisted"]
    run_id: UUID
    business_id: UUID
    strategy_id: UUID
    content_cycle_id: UUID
    content_pack_id: UUID
    content_item_id: UUID
    content_item_version_id: UUID
    content_item_version: int = Field(ge=1)
    content_item_version_checksum: SHA256


class ContentDraftHandoffV1(FrozenModel):
    """Immutable draft returned to Nest before the owner decision pause."""

    contract_version: Literal["content-draft-handoff-v1"]
    run_id: UUID
    business_id: UUID
    owner_user_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_decision: StrategyDecisionBindingV1
    pack: ContentPack
    item_versions: list[ContentItemVersion] = Field(min_length=3, max_length=5)
    validation: ContentValidationResult
    quality_review: ContentQualityReviewV1
    immutable_input_refs: dict[str, Any]
