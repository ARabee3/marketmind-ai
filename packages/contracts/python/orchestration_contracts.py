"""Pydantic mirror of the versioned orchestration contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from content_base import FrozenModel

UUID = str
IsoDateTime = str

OrchestrationContractVersion = Literal["orchestration-v1"]
ResearchPackContractVersion = Literal["research-pack-v1"]
ResearchSourceKind = Literal[
    "owner_input",
    "discovery_evidence",
    "approved_knowledge",
    "trusted_research",
]
OrchestrationStatus = Literal[
    "queued",
    "running",
    "awaiting_strategy_approval",
    "awaiting_content_approval",
    "completed",
    "failed",
    "cancelled",
]
OrchestrationRole = Literal["research", "strategy", "content"]
OrchestrationStage = Literal[
    "prepare",
    "research",
    "strategy",
    "strategy_approval",
    "content",
    "content_approval",
    "complete",
    "failed",
    "cancelled",
]
OrchestrationEventType = Literal[
    "run_created",
    "node_started",
    "node_completed",
    "tool_started",
    "tool_completed",
    "validation",
    "interrupt",
    "resume",
    "terminal",
    "error",
]


class ResearchFactV1(FrozenModel):
    statement: str = Field(min_length=1)
    source_ref: str = Field(min_length=1)
    source_kind: ResearchSourceKind
    fetched_at: IsoDateTime = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    relevance: float = Field(ge=0, le=1)


class ResearchAssumptionV1(FrozenModel):
    statement: str = Field(min_length=1)
    source_ref: str | None
    reason: str = Field(min_length=1)


class ResearchKnowledgeGapV1(FrozenModel):
    field_key: str = Field(min_length=1)
    question_hint: str = Field(min_length=1)
    priority: int = Field(ge=1)
    blocking: bool


class ResearchPackV1(FrozenModel):
    contract_version: ResearchPackContractVersion
    run_id: UUID = Field(min_length=1)
    business_id: UUID = Field(min_length=1)
    profile_version_id: UUID = Field(min_length=1)
    facts: list[ResearchFactV1]
    assumptions: list[ResearchAssumptionV1]
    knowledge_gaps: list[ResearchKnowledgeGapV1]
    source_quality_summary: str = Field(min_length=1)
    stop_reason: Literal[
        "sufficient_evidence",
        "owner_blocker",
        "budget_exhausted",
        "provider_failure",
    ]


class OrchestrationImmutableInputRefsV1(FrozenModel):
    confirmed_profile_version_id: UUID = Field(min_length=1)
    confirmed_profile_version: int = Field(ge=1)
    confirmed_profile_checksum: str = Field(min_length=1)
    strategy_id: UUID = Field(min_length=1)
    strategy_brief_id: UUID = Field(min_length=1)
    requested_week_number: int | None = Field(default=None, ge=1, le=12)
    week_context_id: UUID | None = None
    week_context_checksum: str | None = None


class StrategyDecisionBindingV1(FrozenModel):
    binding_type: Literal["strategy"]
    run_id: UUID = Field(min_length=1)
    business_id: UUID = Field(min_length=1)
    strategy_id: UUID = Field(min_length=1)
    strategy_version_id: UUID = Field(min_length=1)
    strategy_version: int = Field(ge=1)
    strategy_checksum: str = Field(min_length=1)
    decision_id: UUID = Field(min_length=1)
    decision: Literal["approved", "rejected", "revision_requested"]
    decided_by_user_id: UUID = Field(min_length=1)
    decided_at: IsoDateTime = Field(min_length=1)


class ContentDecisionBindingV1(FrozenModel):
    binding_type: Literal["content"]
    run_id: UUID = Field(min_length=1)
    business_id: UUID = Field(min_length=1)
    content_cycle_id: UUID = Field(min_length=1)
    content_pack_id: UUID = Field(min_length=1)
    content_item_id: UUID = Field(min_length=1)
    content_item_version_id: UUID = Field(min_length=1)
    content_item_version: int = Field(ge=1)
    content_item_version_checksum: str = Field(min_length=1)
    decision_id: UUID = Field(min_length=1)
    decision: Literal["approved", "rejected", "revision_requested"]
    decided_by_user_id: UUID = Field(min_length=1)
    decided_at: IsoDateTime = Field(min_length=1)


class CampaignOrchestrationStartV1(FrozenModel):
    contract_version: OrchestrationContractVersion
    run_id: UUID = Field(min_length=1)
    correlation_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    owner_user_id: UUID = Field(min_length=1)
    business_id: UUID = Field(min_length=1)
    graph_name: str = Field(min_length=1)
    graph_version: str = Field(min_length=1)
    feature_cohort: str = Field(min_length=1)
    confirmed_profile_version_id: UUID = Field(min_length=1)
    confirmed_profile_version: int = Field(ge=1)
    confirmed_profile_checksum: str = Field(min_length=1)
    strategy_id: UUID = Field(min_length=1)
    strategy_brief_id: UUID = Field(min_length=1)
    requested_week_number: int | None = Field(default=None, ge=1, le=12)
    requested_at: IsoDateTime = Field(min_length=1)


class CampaignOrchestrationResumeV1(FrozenModel):
    contract_version: OrchestrationContractVersion
    run_id: UUID = Field(min_length=1)
    checkpoint_thread_id: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    owner_user_id: UUID = Field(min_length=1)
    business_id: UUID = Field(min_length=1)
    decision_binding: StrategyDecisionBindingV1 | ContentDecisionBindingV1
    requested_at: IsoDateTime = Field(min_length=1)


class OrchestrationStrategyStateV1(FrozenModel):
    draft_id: UUID | None = None
    version_id: UUID | None = None
    version: int | None = Field(default=None, ge=1)
    checksum: str | None = None
    validation_valid: bool | None = None
    pending_decision: bool


class OrchestrationContentStateV1(FrozenModel):
    cycle_id: UUID | None = None
    pack_id: UUID | None = None
    item_id: UUID | None = None
    item_version_id: UUID | None = None
    item_version: int | None = Field(default=None, ge=1)
    checksum: str | None = None
    validation_valid: bool | None = None
    pending_decision: bool


class OrchestrationBoundsV1(FrozenModel):
    tool_calls_used: int = Field(ge=0)
    tool_calls_limit: int = Field(ge=0)
    replans_used: int = Field(ge=0)
    replans_limit: int = Field(ge=0)
    token_budget: int | None = Field(default=None, ge=0)
    cost_budget_usd: float | None = Field(default=None, ge=0)
    deadline_at: IsoDateTime | None = None


class OrchestrationAuditV1(FrozenModel):
    prompt_versions: list[str]
    provider_versions: list[str]
    action_summaries: list[str]
    stable_errors: list[str]
    created_at: IsoDateTime = Field(min_length=1)
    updated_at: IsoDateTime = Field(min_length=1)


class CampaignOrchestrationStateV1(FrozenModel):
    contract_version: OrchestrationContractVersion
    run_id: UUID = Field(min_length=1)
    correlation_id: str = Field(min_length=1)
    owner_user_id: UUID = Field(min_length=1)
    business_id: UUID = Field(min_length=1)
    graph_name: str = Field(min_length=1)
    graph_version: str = Field(min_length=1)
    status: OrchestrationStatus
    current_role: OrchestrationRole | None = None
    current_stage: OrchestrationStage
    feature_cohort: str = Field(min_length=1)
    immutable_input: OrchestrationImmutableInputRefsV1
    research_pack: ResearchPackV1 | None = None
    strategy: OrchestrationStrategyStateV1
    content: OrchestrationContentStateV1
    bounds: OrchestrationBoundsV1
    audit: OrchestrationAuditV1


class OrchestrationErrorV1(FrozenModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    retryable: bool
    details: dict[str, Any]


class CampaignOrchestrationResultV1(FrozenModel):
    contract_version: OrchestrationContractVersion
    run_id: UUID = Field(min_length=1)
    status: OrchestrationStatus
    checkpoint_thread_id: str = Field(min_length=1)
    checkpoint_version: int = Field(ge=0)
    state: CampaignOrchestrationStateV1
    error: OrchestrationErrorV1 | None = None


class CampaignOrchestrationEventV1(FrozenModel):
    contract_version: OrchestrationContractVersion
    event_id: UUID = Field(min_length=1)
    run_id: UUID = Field(min_length=1)
    seq: int = Field(ge=1)
    event_type: OrchestrationEventType
    status: OrchestrationStatus
    current_role: OrchestrationRole | None = None
    current_stage: OrchestrationStage
    node: str | None = None
    tool: str | None = None
    summary: str = Field(min_length=1)
    payload: dict[str, Any]
    created_at: IsoDateTime = Field(min_length=1)
