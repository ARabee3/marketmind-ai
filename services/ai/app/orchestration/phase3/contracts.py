"""Typed, JSON-safe contracts for the Phase 3 Strategy graph.

The graph deliberately carries only versioned inputs, the generated Strategy
artifact, and compact review/approval metadata.  Owner persistence remains an
injected boundary owned by the Nest application; this package does not write
Strategy rows or change the existing Strategy endpoints.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from content_base import FrozenModel
from orchestration_contracts import (
    CampaignOrchestrationStartV1,
    ResearchPackV1,
    SHA256,
    UUID,
)
from strategy_contracts import (
    BusinessProfilePayload,
    RetrievedKnowledgePack,
    StrategyBrief,
    StrategyGenerateRequest,
    StrategyPlan,
    StrategyValidationResult,
)


class Phase3InputV1(FrozenModel):
    """All immutable snapshots required to prepare one Strategy handoff."""

    contract_version: Literal["phase3-input-v1"]
    start: CampaignOrchestrationStartV1
    business_profile: BusinessProfilePayload
    strategy_brief: StrategyBrief
    retrieval_pack: RetrievedKnowledgePack
    research_pack: ResearchPackV1


class ResearchStrategyHandoffV1(FrozenModel):
    """The explicit, typed boundary from Research to Strategy."""

    contract_version: Literal["research-strategy-handoff-v1"]
    run_id: UUID
    business_id: UUID
    profile_version_id: UUID
    strategy_id: UUID
    strategy_brief_id: UUID
    research_pack: ResearchPackV1
    strategy_request: StrategyGenerateRequest


class PreparedPhase3InputV1(FrozenModel):
    """Validated input plus deterministic Strategy request for the graph."""

    contract_version: Literal["prepared-phase3-input-v1"]
    start: CampaignOrchestrationStartV1
    handoff: ResearchStrategyHandoffV1


class StrategyQualityReviewV1(FrozenModel):
    """Visible review decision; no hidden chain-of-thought is retained."""

    contract_version: Literal["strategy-quality-review-v1"]
    artifact_type: Literal["strategy_plan"]
    valid: bool
    issue_code: str | None = None
    field: str | None = None
    severity: Literal["info", "warning", "blocking"]
    repairable: bool
    short_explanation: str = Field(min_length=1, max_length=500)
    recommended_node: Literal["strategy", "owner", "terminal"]


class StrategyApprovalInterruptV1(FrozenModel):
    """Compact JSON payload presented to the owner-facing approval boundary."""

    kind: Literal["strategy_approval"]
    run_id: UUID
    business_id: UUID
    owner_user_id: UUID
    strategy_id: UUID
    draft_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_checksum: SHA256
    message: str = Field(min_length=1, max_length=300)
    persistence_required: bool = True


class StrategyDraftPersistenceReceiptV1(FrozenModel):
    """Nest receipt that binds the paused draft to its persisted version."""

    kind: Literal["strategy_draft_persisted"]
    run_id: UUID
    business_id: UUID
    strategy_id: UUID
    draft_id: UUID
    strategy_version_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_checksum: SHA256


class StrategyDraftHandoffV1(FrozenModel):
    """Immutable artifact handoff for Nest persistence after graph pause."""

    contract_version: Literal["strategy-draft-handoff-v1"]
    run_id: UUID
    business_id: UUID
    owner_user_id: UUID
    strategy_id: UUID
    strategy_brief_id: UUID
    profile_version_id: UUID
    draft_id: UUID
    strategy_version: int = Field(ge=1)
    strategy_checksum: SHA256
    plan: StrategyPlan
    validation: StrategyValidationResult
    quality_review: StrategyQualityReviewV1
    research_pack: ResearchPackV1
    immutable_input_refs: dict[str, Any]
