"""
Strategy Contracts — Pydantic v2 models for MarketMind AI.

Cross-language parity with packages/contracts/src/strategy/*.ts.
Round-trips against JSON fixtures under packages/contracts/examples/.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional, Literal

UUID = str

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enums: parity with TypeScript `as const` arrays
# ---------------------------------------------------------------------------

class StrategyObjective(str, Enum):
    awareness = "awareness"
    acquisition = "acquisition"
    conversion = "conversion"
    retention = "retention"
    launch = "launch"


class ExternalBudgetMode(str, Enum):
    organic_only = "organic_only"
    monthly_amount = "monthly_amount"
    three_month_amount = "three_month_amount"
    scenario_only = "scenario_only"


class EvidenceTier(str, Enum):
    verified_benchmark = "verified_benchmark"
    reviewed_guidance = "reviewed_guidance"
    contextual_note = "contextual_note"
    model_synthesis = "model_synthesis"


class ClaimSource(str, Enum):
    confirmed_fact = "confirmed_fact"
    owner_input = "owner_input"
    retrieved_evidence = "retrieved_evidence"
    deterministic_result = "deterministic_result"
    model_synthesis = "model_synthesis"


class ChannelRole(str, Enum):
    primary = "primary"
    supporting = "supporting"


class KpiTargetMode(str, Enum):
    establish_baseline = "establish_baseline"
    owner_target = "owner_target"
    baseline_improvement = "baseline_improvement"
    verified_benchmark_range = "verified_benchmark_range"


class StrategyStatus(str, Enum):
    needs_brief = "needs_brief"
    ready = "ready"
    retrieving = "retrieving"
    queued = "queued"
    generating = "generating"
    validating = "validating"
    draft = "draft"
    approved = "approved"
    rejected = "rejected"
    failed = "failed"


class LanguageMode(str, Enum):
    ar_EG = "ar-EG"
    en = "en"
    mixed = "mixed"


class ReviewStatus(str, Enum):
    approved = "approved"
    retired = "retired"
    expired = "expired"


class BlockerSeverity(str, Enum):
    blocking = "blocking"
    warning = "warning"


class GapSeverity(str, Enum):
    blocking = "blocking"
    non_critical = "non_critical"


class ScenarioType(str, Enum):
    conservative = "conservative"
    base = "base"
    growth = "growth"


class DecisionType(str, Enum):
    approved = "approved"
    rejected = "rejected"
    revision_requested = "revision_requested"


class ProgressStage(str, Enum):
    queued = "queued"
    query_planning = "query_planning"
    retrieval = "retrieval"
    generating = "generating"
    validating = "validating"
    ready = "ready"
    failed = "failed"


class ProgressStatus(str, Enum):
    started = "started"
    progress = "progress"
    complete = "complete"
    failed = "failed"


# ---------------------------------------------------------------------------
# Shared / ID types
# ---------------------------------------------------------------------------

ContractVersionLiteral = Literal["strategy-v1"]
CurrencyCodeLiteral = Literal["EGP"]


class BusinessProfileVersionRef(BaseModel):
    business_profile_version_id: UUID
    confirmed_at: datetime
    version: int


# ---------------------------------------------------------------------------
# Strategy Brief (Task 2)
# ---------------------------------------------------------------------------

class StrategyClarification(BaseModel):
    question_id: UUID
    question_text: str
    answer_text: str
    answered_at: datetime


class StrategyBlocker(BaseModel):
    code: str
    field: Optional[str] = None
    message: str
    severity: BlockerSeverity


class StrategyReadiness(BaseModel):
    ready: bool
    blockers: list[StrategyBlocker]
    profile_version_current: bool


class StrategyBrief(BaseModel):
    meta: Optional[dict[str, Any]] = None
    id: UUID
    strategy_id: UUID
    business_profile_version: BusinessProfileVersionRef
    primary_objective: StrategyObjective
    start_date: datetime
    plan_language: LanguageMode
    paid_media_allowed: bool
    external_budget_mode: ExternalBudgetMode
    external_budget_egp: Optional[float]
    team_capacity: str
    constraints: list[str]
    clarification_answers: list[StrategyClarification]
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_budget_required(self) -> "StrategyBrief":
        if self.external_budget_mode in (
            ExternalBudgetMode.monthly_amount,
            ExternalBudgetMode.three_month_amount,
        ):
            if self.external_budget_egp is None:
                raise ValueError(
                    "external_budget_egp must be non-null when mode "
                    "is monthly_amount or three_month_amount"
                )
        if not self.paid_media_allowed:
            if self.external_budget_mode not in (
                ExternalBudgetMode.organic_only,
                ExternalBudgetMode.scenario_only,
            ):
                raise ValueError(
                    "paid_media_allowed is false but budget mode implies spend"
                )
        return self


# ---------------------------------------------------------------------------
# Strategy Retrieval (Task 3)
# ---------------------------------------------------------------------------

class RetrievalQueryContext(BaseModel):
    business_type: str
    market: str
    locale: str
    objective: StrategyObjective
    funnel_stage: str
    active_channels: list[str]
    asset_capability: list[str]
    team_capacity: str
    budget_mode: ExternalBudgetMode
    industry: Optional[str] = None


class SourceQuality(BaseModel):
    evidence_tier: EvidenceTier
    source_references: list[str]
    effective_at: datetime
    expires_at: Optional[datetime] = None
    review_status: ReviewStatus


class RetrievedKnowledgeItem(BaseModel):
    chunk_id: UUID
    entry_id: UUID
    entry_version: int
    title: str
    excerpt: str
    kind: str
    tags: dict[str, list[str]]
    relevance_score: float
    source_quality: SourceQuality


class KnowledgeGapItem(BaseModel):
    category: str
    description: str
    severity: GapSeverity


class RetrievalMetadata(BaseModel):
    embedding_provider: str
    embedding_model: str
    embedding_dimensions: int
    collection_name: str
    retrieval_latency_ms: int


class RetrievedKnowledgePack(BaseModel):
    meta: Optional[dict[str, Any]] = None
    retrieval_run_id: UUID
    query_summary: str
    query_context: RetrievalQueryContext
    profile_version_id: UUID
    brief_id: UUID
    items: list[RetrievedKnowledgeItem]
    knowledge_gaps: list[KnowledgeGapItem]
    retrieval_metadata: RetrievalMetadata
    retrieved_at: datetime

    @model_validator(mode="after")
    def validate_retrieved_pack(self) -> "RetrievedKnowledgePack":
        for item in self.items:
            if item.source_quality.expires_at:
                expires = item.source_quality.expires_at
                retrieved = self.retrieved_at
                if expires.tzinfo is not None and retrieved.tzinfo is None:
                    expires = expires.replace(tzinfo=None)
                elif expires.tzinfo is None and retrieved.tzinfo is not None:
                    retrieved = retrieved.replace(tzinfo=None)
                if expires < retrieved:
                    if item.source_quality.review_status not in (ReviewStatus.expired, ReviewStatus.retired):
                        raise ValueError(
                            f"item {item.chunk_id} has expired but review_status is {item.source_quality.review_status}"
                        )
        if len(self.items) == 0:
            if self.retrieval_metadata.retrieval_latency_ms == 0:
                raise ValueError("empty items array with no latency indicates retrieval failure")
        return self


class PlanCitation(BaseModel):
    citation_id: UUID
    chunk_id: UUID
    entry_id: UUID
    entry_version: int
    title: str
    excerpt: str
    evidence_tier: EvidenceTier
    relevance_score: float


# ---------------------------------------------------------------------------
# Strategy Plan (Task 4)
# ---------------------------------------------------------------------------

class SourcedClaim(BaseModel):
    text: str
    source: ClaimSource
    citation_ids: list[UUID]
    confidence_note: Optional[str] = None


class ChannelDimensionScores(BaseModel):
    objective_fit: float
    audience_fit: float
    existing_presence: float
    asset_format_fit: float
    team_capacity: float
    budget_fit: float
    evidence_strength: float
    measurement_readiness: float


class ChannelScorecard(BaseModel):
    channel: str
    role: ChannelRole
    scores: ChannelDimensionScores
    total_score: float
    rationale: SourcedClaim
    excluded_reason: Optional[str] = None


class KpiTarget(BaseModel):
    metric: str
    funnel_stage: str
    target_mode: KpiTargetMode
    target_value: Optional[str] = None
    benchmark_citation_id: Optional[UUID] = None
    measurement_method: str
    notes: SourcedClaim

    @model_validator(mode="after")
    def validate_benchmark_citation(self) -> "KpiTarget":
        if self.target_mode == KpiTargetMode.verified_benchmark_range:
            if self.benchmark_citation_id is None:
                raise ValueError(
                    "benchmark_citation_id must be non-null when target_mode is verified_benchmark_range"
                )
        return self


class ChannelAllocation(BaseModel):
    channel: str
    amount_egp: float
    percentage: float


class BudgetScenario(BaseModel):
    scenario_type: ScenarioType
    total_egp: float
    currency: CurrencyCodeLiteral = "EGP"
    channel_allocations: list[ChannelAllocation]
    notes: SourcedClaim

    @model_validator(mode="after")
    def validate_budget_scenarios_sum(self) -> "BudgetScenario":
        total_allocated = sum(alloc.amount_egp for alloc in self.channel_allocations)
        if abs(total_allocated - self.total_egp) >= 0.01:
            raise ValueError(f"channel allocations must sum to total_egp ({total_allocated} != {self.total_egp})")
        return self


class WeekPlan(BaseModel):
    week_number: int
    theme: str
    formats: list[str]
    notes: Optional[str] = None


class ExperimentPlan(BaseModel):
    id: UUID
    hypothesis: str
    method: str
    success_criteria: str
    week_range: tuple[int, int]


class ContentStrategyRoadmap(BaseModel):
    meta: Optional[dict[str, Any]] = None
    pillars: list[SourcedClaim]
    format_mix: list[SourcedClaim]
    weekly_cadence: str
    weeks: list[WeekPlan]
    experiments: list[ExperimentPlan]

    @model_validator(mode="after")
    def validate_roadmap_constraints(self) -> "ContentStrategyRoadmap":
        if not (3 <= len(self.pillars) <= 5):
            raise ValueError("pillars length must be 3-5")
        if len(self.weeks) != 12:
            raise ValueError("weeks must have 12 entries")
        return self


class StrategyPlan(BaseModel):
    meta: Optional[dict[str, Any]] = None
    id: UUID
    strategy_id: UUID
    version: int
    contract_version: str = "strategy-v1"
    brief_id: UUID
    profile_version: BusinessProfileVersionRef
    retrieval_run_id: UUID
    executive_summary: SourcedClaim
    situation_diagnosis: SourcedClaim
    primary_objective: StrategyObjective
    funnel_stage: str
    target_audience: SourcedClaim
    positioning: SourcedClaim
    selected_channels: list[ChannelScorecard]
    all_channel_scores: list[ChannelScorecard]
    tone: SourcedClaim
    plan_language: LanguageMode
    content_strategy: ContentStrategyRoadmap
    budget_mode: ExternalBudgetMode
    budget_scenarios: Optional[list[BudgetScenario]] = None
    kpi_targets: list[KpiTarget]
    assumptions: list[SourcedClaim]
    risks: list[SourcedClaim]
    knowledge_gaps: list[KnowledgeGapItem]
    blockers: list[StrategyBlocker]
    citations: list[PlanCitation]
    created_at: datetime

    @model_validator(mode="after")
    def validate_plan_constraints(self) -> "StrategyPlan":
        primary_count = sum(1 for ch in self.selected_channels if ch.role == ChannelRole.primary)
        supporting_count = sum(1 for ch in self.selected_channels if ch.role == ChannelRole.supporting)
        if primary_count > 2:
            raise ValueError(f"at most 2 primary channels allowed, got {primary_count}")
        if supporting_count > 1:
            raise ValueError(f"at most 1 supporting channel allowed, got {supporting_count}")

        if self.budget_mode == ExternalBudgetMode.organic_only:
            if self.budget_scenarios is not None:
                raise ValueError("budget_scenarios must be null when mode is organic_only")
        else:
            if self.budget_scenarios is None:
                raise ValueError("budget_scenarios must be an array when mode is not organic_only")

        citation_ids = {c.citation_id for c in self.citations}
        def check_claim(claim: Optional[SourcedClaim], name: str):
            if claim and claim.citation_ids:
                for cid in claim.citation_ids:
                    if cid not in citation_ids:
                        raise ValueError(f"citation_id {cid} in {name} not found in citations[]")

        check_claim(self.executive_summary, "executive_summary")
        check_claim(self.situation_diagnosis, "situation_diagnosis")
        check_claim(self.target_audience, "target_audience")
        check_claim(self.positioning, "positioning")
        check_claim(self.tone, "tone")
        for idx, claim in enumerate(self.assumptions):
            check_claim(claim, f"assumptions[{idx}]")
        for idx, claim in enumerate(self.risks):
            check_claim(claim, f"risks[{idx}]")
        for idx, p in enumerate(self.content_strategy.pillars):
            check_claim(p, f"content_strategy.pillars[{idx}]")
        for idx, f in enumerate(self.content_strategy.format_mix):
            check_claim(f, f"content_strategy.format_mix[{idx}]")
        for idx, k in enumerate(self.kpi_targets):
            check_claim(k.notes, f"kpi_targets[{idx}].notes")
        if self.budget_scenarios:
            for idx, s in enumerate(self.budget_scenarios):
                check_claim(s.notes, f"budget_scenarios[{idx}].notes")
        for idx, ch in enumerate(self.selected_channels):
            check_claim(ch.rationale, f"selected_channels[{idx}].rationale")
        for idx, ch in enumerate(self.all_channel_scores):
            check_claim(ch.rationale, f"all_channel_scores[{idx}].rationale")

        return self


# ---------------------------------------------------------------------------
# Strategy Lifecycle (Task 5)
# ---------------------------------------------------------------------------

class OwnerDecision(BaseModel):
    meta: Optional[dict[str, Any]] = None
    id: UUID
    strategy_id: UUID
    strategy_version: int
    decision: DecisionType
    revision_notes: Optional[str] = None
    decided_by_user_id: UUID
    decided_at: datetime


class StrategyVersionSummary(BaseModel):
    strategy_id: UUID
    version: int
    status: StrategyStatus
    brief_id: UUID
    retrieval_run_id: UUID
    created_at: datetime
    decision: Optional[OwnerDecision] = None


class StrategyProgressEvent(BaseModel):
    meta: Optional[dict[str, Any]] = None
    type: str = "strategy_progress"
    strategy_id: UUID
    seq: int
    stage: ProgressStage
    status: ProgressStatus
    message_key: str
    message_text: str
    retryable: Optional[bool] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
