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


class ExternalBudgetRangeEgp(BaseModel):
    min_egp: float = Field(gt=0)
    max_egp: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> "ExternalBudgetRangeEgp":
        if self.min_egp > self.max_egp:
            raise ValueError("min_egp must not exceed max_egp")
        return self


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
    external_budget_egp: Optional[float | ExternalBudgetRangeEgp] = None
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
            if (
                isinstance(self.external_budget_egp, (int, float))
                and self.external_budget_egp <= 0
            ):
                raise ValueError("external_budget_egp must be positive")
        elif self.external_budget_mode == ExternalBudgetMode.organic_only:
            if self.external_budget_egp is not None:
                raise ValueError(
                    "external_budget_egp must be null when mode is organic_only"
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
    review_status: Literal["approved"]


class RetrievedKnowledgeItem(BaseModel):
    chunk_id: UUID
    entry_id: UUID
    entry_version: int = Field(gt=0)
    title: str
    excerpt: str
    kind: str
    tags: dict[str, list[str]]
    relevance_score: float = Field(ge=0, le=1)
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
            if item.source_quality.effective_at > self.retrieved_at:
                raise ValueError(
                    f"item {item.chunk_id} is not effective at retrieval time"
                )
            if item.source_quality.expires_at:
                expires = item.source_quality.expires_at
                retrieved = self.retrieved_at
                if expires.tzinfo is not None and retrieved.tzinfo is None:
                    expires = expires.replace(tzinfo=None)
                elif expires.tzinfo is None and retrieved.tzinfo is not None:
                    retrieved = retrieved.replace(tzinfo=None)
                if expires < retrieved:
                    raise ValueError(f"item {item.chunk_id} is expired")
        if len(self.items) == 0:
            if self.retrieval_metadata.retrieval_latency_ms == 0:
                raise ValueError("empty items array with no latency indicates retrieval failure")
        return self


class PlanCitation(BaseModel):
    citation_id: UUID
    chunk_id: UUID
    entry_id: UUID
    entry_version: int = Field(gt=0)
    title: str
    excerpt: str
    evidence_tier: EvidenceTier
    relevance_score: float = Field(ge=0, le=1)


# ---------------------------------------------------------------------------
# Strategy Plan (Task 4)
# ---------------------------------------------------------------------------

class SourcedClaim(BaseModel):
    text: str
    source: ClaimSource
    citation_ids: list[UUID]
    confidence_note: Optional[str] = None

    @model_validator(mode="after")
    def validate_provenance(self) -> "SourcedClaim":
        if self.source == ClaimSource.retrieved_evidence and not self.citation_ids:
            raise ValueError("retrieved_evidence claims require a citation")
        if self.source in (ClaimSource.confirmed_fact, ClaimSource.owner_input):
            if self.citation_ids:
                raise ValueError(
                    "confirmed_fact and owner_input claims cannot cite retrieval knowledge"
                )
        return self


class ChannelDimensionScores(BaseModel):
    objective_fit: float = Field(ge=0, le=1)
    audience_fit: float = Field(ge=0, le=1)
    existing_presence: float = Field(ge=0, le=1)
    asset_format_fit: float = Field(ge=0, le=1)
    team_capacity: float = Field(ge=0, le=1)
    budget_fit: float = Field(ge=0, le=1)
    evidence_strength: float = Field(ge=0, le=1)
    measurement_readiness: float = Field(ge=0, le=1)


class DeterministicChannelScorecard(BaseModel):
    channel: str
    role: ChannelRole
    scores: ChannelDimensionScores
    total_score: float = Field(ge=0, le=8)
    excluded_reason: Optional[str] = None


class ChannelScorecard(DeterministicChannelScorecard):
    rationale: SourcedClaim


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
    amount_egp: float = Field(ge=0)
    percentage: float = Field(ge=0, le=100)


class BudgetScenario(BaseModel):
    scenario_type: ScenarioType
    period: Literal["monthly", "twelve_week"]
    total_egp: float = Field(gt=0)
    currency: CurrencyCodeLiteral = "EGP"
    channel_allocations: list[ChannelAllocation]
    requires_owner_budget_approval: bool
    notes: SourcedClaim

    @model_validator(mode="after")
    def validate_budget_scenarios_sum(self) -> "BudgetScenario":
        total_allocated = sum(alloc.amount_egp for alloc in self.channel_allocations)
        if abs(total_allocated - self.total_egp) >= 0.01:
            raise ValueError(f"channel allocations must sum to total_egp ({total_allocated} != {self.total_egp})")
        percentage_total = sum(alloc.percentage for alloc in self.channel_allocations)
        if abs(percentage_total - 100) >= 0.01:
            raise ValueError(
                f"channel allocation percentages must sum to 100 ({percentage_total} != 100)"
            )
        return self


class WeekPlan(BaseModel):
    week_number: int = Field(ge=1, le=12)
    theme: str
    formats: list[str]
    notes: Optional[str] = None


class ExperimentPlan(BaseModel):
    id: UUID
    hypothesis: str
    method: str
    success_criteria: str
    week_range: tuple[int, int]

    @model_validator(mode="after")
    def validate_week_range(self) -> "ExperimentPlan":
        start, end = self.week_range
        if start < 1 or end > 12 or start > end:
            raise ValueError("week_range must be ordered and within weeks 1-12")
        return self


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
        if {week.week_number for week in self.weeks} != set(range(1, 13)):
            raise ValueError("weeks must contain each week number from 1 through 12 exactly once")
        return self


class StrategyPlan(BaseModel):
    meta: Optional[dict[str, Any]] = None
    id: UUID
    strategy_id: UUID
    version: int = Field(gt=0)
    contract_version: Literal["strategy-v1"] = "strategy-v1"
    brief_id: UUID
    profile_version: BusinessProfileVersionRef
    retrieval_run_id: UUID
    channel_score_rule_version: Literal["strategy-channel-score-v1"]
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

        selected_names = [score.channel for score in self.selected_channels]
        if len(set(selected_names)) != len(selected_names):
            raise ValueError("selected_channels must not contain duplicate channels")

        all_scores_by_channel = {score.channel: score for score in self.all_channel_scores}
        if len(all_scores_by_channel) != len(self.all_channel_scores):
            raise ValueError("all_channel_scores must not contain duplicate channels")
        for score in self.all_channel_scores:
            expected_total = round(sum(score.scores.model_dump().values()), 2)
            if score.total_score != expected_total:
                raise ValueError(
                    f"channel {score.channel} total_score must equal {expected_total}"
                )
        for selected in self.selected_channels:
            canonical = all_scores_by_channel.get(selected.channel)
            if canonical is None:
                raise ValueError(
                    f"selected channel {selected.channel} is missing from all_channel_scores"
                )
            selected_values = selected.model_dump(
                include={
                    "channel",
                    "role",
                    "scores",
                    "total_score",
                    "excluded_reason",
                }
            )
            canonical_values = canonical.model_dump(
                include={
                    "channel",
                    "role",
                    "scores",
                    "total_score",
                    "excluded_reason",
                }
            )
            if selected_values != canonical_values:
                raise ValueError(
                    f"selected channel {selected.channel} must reuse deterministic scores"
                )

        if self.budget_mode == ExternalBudgetMode.organic_only:
            if self.budget_scenarios is not None:
                raise ValueError("budget_scenarios must be null when mode is organic_only")
        else:
            if self.budget_scenarios is None:
                raise ValueError("budget_scenarios must be an array when mode is not organic_only")
            scenario_types = [
                scenario.scenario_type for scenario in self.budget_scenarios
            ]
            if (
                ScenarioType.base not in scenario_types
                or len(set(scenario_types)) != len(scenario_types)
            ):
                raise ValueError("budget_scenarios needs one unique base scenario")

        citation_ids = {c.citation_id for c in self.citations}
        citations_by_id = {c.citation_id: c for c in self.citations}
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
            if k.target_mode == KpiTargetMode.verified_benchmark_range:
                citation = citations_by_id.get(k.benchmark_citation_id or "")
                if not k.target_value or citation is None:
                    raise ValueError(
                        f"kpi_targets[{idx}] needs a target value and existing benchmark citation"
                    )
                if citation.evidence_tier != EvidenceTier.verified_benchmark:
                    raise ValueError(
                        f"kpi_targets[{idx}] citation must be a verified_benchmark"
                    )
        if self.budget_scenarios:
            for idx, s in enumerate(self.budget_scenarios):
                check_claim(s.notes, f"budget_scenarios[{idx}].notes")
        for idx, ch in enumerate(self.selected_channels):
            check_claim(ch.rationale, f"selected_channels[{idx}].rationale")
        for idx, ch in enumerate(self.all_channel_scores):
            check_claim(ch.rationale, f"all_channel_scores[{idx}].rationale")

        return self


# ---------------------------------------------------------------------------
# Public/internal interface contracts and cross-object policy validation
# ---------------------------------------------------------------------------

class BusinessProfilePayload(BaseModel):
    id: UUID
    business_id: UUID
    draft_id: Optional[UUID] = None
    version: int = Field(gt=0)
    profile: dict[str, Any]
    confirmed_by_user_id: UUID
    confirmed_at: datetime
    created_at: datetime


class CreateStrategyRequest(BaseModel):
    business_profile_version_id: UUID


class GenerateStrategyRequest(BaseModel):
    expected_profile_version_id: UUID
    idempotency_key: str = Field(min_length=1)


class UpdateStrategyBriefRequest(BaseModel):
    business_profile_version: BusinessProfileVersionRef
    primary_objective: StrategyObjective
    start_date: datetime
    plan_language: LanguageMode
    paid_media_allowed: bool
    external_budget_mode: ExternalBudgetMode
    external_budget_egp: Optional[float | ExternalBudgetRangeEgp] = None
    team_capacity: str
    constraints: list[str]
    clarification_answers: list[StrategyClarification]

    @model_validator(mode="after")
    def validate_budget(self) -> "UpdateStrategyBriefRequest":
        StrategyBrief(
            id="00000000-0000-4000-8000-000000000000",
            strategy_id="00000000-0000-4000-8000-000000000001",
            created_at=datetime.min,
            updated_at=datetime.min,
            **self.model_dump(),
        )
        return self


class StrategyKnowledgeRetrievalRequest(BaseModel):
    contract_version: Literal["strategy-v1"]
    strategy_id: UUID
    brief: StrategyBrief
    query_context: RetrievalQueryContext


class StrategyGenerateRequest(BaseModel):
    contract_version: Literal["strategy-v1"]
    strategy_id: UUID
    business_profile: BusinessProfilePayload
    brief: StrategyBrief
    retrieved_knowledge_pack: RetrievedKnowledgePack
    deterministic_channel_scores: list[DeterministicChannelScorecard]


class StrategyReviseRequest(StrategyGenerateRequest):
    previous_plan: StrategyPlan
    revision_notes: str = Field(min_length=1)


StrategyValidationCode = Literal[
    "STRATEGY_PROFILE_STALE",
    "STRATEGY_PROFILE_UNCONFIRMED",
    "STRATEGY_KNOWLEDGE_GAP",
    "STRATEGY_RETRIEVAL_FAILURE",
    "STRATEGY_INVALID_CITATION",
    "STRATEGY_INVALID_BENCHMARK",
    "STRATEGY_ARITHMETIC_FAILURE",
    "STRATEGY_RULE_VIOLATION",
    "STRATEGY_BUDGET_MISMATCH",
    "STRATEGY_CHANNEL_LIMIT_EXCEEDED",
    "STRATEGY_EVIDENCE_NOT_APPROVED",
    "STRATEGY_SCORE_MISMATCH",
    "STRATEGY_APPROVAL_BLOCKED",
]


class StrategyValidationIssue(BaseModel):
    code: StrategyValidationCode
    field: str
    message: str


class StrategyValidationResult(BaseModel):
    valid: bool
    issues: list[StrategyValidationIssue]


class StrategyGenerateResponse(BaseModel):
    plan: StrategyPlan
    validation: StrategyValidationResult


def validate_strategy_bundle(
    *,
    business_profile: BusinessProfilePayload,
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    deterministic_channel_scores: list[DeterministicChannelScorecard],
    plan: StrategyPlan,
    decision: Optional["OwnerDecision"] = None,
) -> StrategyValidationResult:
    issues: list[StrategyValidationIssue] = []

    def add(code: StrategyValidationCode, field: str, message: str) -> None:
        issues.append(StrategyValidationIssue(code=code, field=field, message=message))

    profile_refs = (brief.business_profile_version, plan.profile_version)
    if any(
        ref.business_profile_version_id != business_profile.id
        or ref.version != business_profile.version
        or ref.confirmed_at != business_profile.confirmed_at
        for ref in profile_refs
    ) or retrieval_pack.profile_version_id != business_profile.id:
        add(
            "STRATEGY_PROFILE_STALE",
            "business_profile_version",
            "Profile, brief, retrieval pack, and plan must reference the same confirmed version.",
        )

    if retrieval_pack.brief_id != brief.id or plan.brief_id != brief.id:
        add(
            "STRATEGY_RULE_VIOLATION",
            "brief_id",
            "Retrieval pack and plan must reference the supplied Strategy Brief.",
        )
    if plan.retrieval_run_id != retrieval_pack.retrieval_run_id:
        add(
            "STRATEGY_RULE_VIOLATION",
            "retrieval_run_id",
            "Plan must reference the supplied persisted retrieval run.",
        )
    if decision is not None and (
        decision.strategy_id != plan.strategy_id
        or decision.strategy_version != plan.version
    ):
        add(
            "STRATEGY_RULE_VIOLATION",
            "decision.strategy_version",
            "An owner decision must reference the exact immutable Strategy version being reviewed.",
        )

    deterministic_names = [score.channel for score in deterministic_channel_scores]
    expected_scores = {
        score.channel: score.model_dump(
            include={"channel", "role", "scores", "total_score", "excluded_reason"}
        )
        for score in deterministic_channel_scores
    }
    actual_scores = {
        score.channel: score.model_dump(
            include={"channel", "role", "scores", "total_score", "excluded_reason"}
        )
        for score in plan.all_channel_scores
    }
    if (
        len(set(deterministic_names)) != len(deterministic_names)
        or expected_scores != actual_scores
    ):
        add(
            "STRATEGY_SCORE_MISMATCH",
            "plan.all_channel_scores",
            "The plan must preserve the deterministic channel score input unchanged.",
        )

    pack_items = {item.chunk_id: item for item in retrieval_pack.items}
    citations = {citation.citation_id: citation for citation in plan.citations}
    for index, citation in enumerate(plan.citations):
        item = pack_items.get(citation.chunk_id)
        if (
            item is None
            or item.entry_id != citation.entry_id
            or item.entry_version != citation.entry_version
            or item.source_quality.evidence_tier != citation.evidence_tier
        ):
            add(
                "STRATEGY_INVALID_CITATION",
                f"plan.citations[{index}]",
                "Every plan citation must resolve exactly to the persisted retrieval pack.",
            )

    for index, target in enumerate(plan.kpi_targets):
        if target.target_mode != KpiTargetMode.verified_benchmark_range:
            continue
        citation = citations.get(target.benchmark_citation_id or "")
        if (
            not target.target_value
            or citation is None
            or citation.evidence_tier != EvidenceTier.verified_benchmark
        ):
            add(
                "STRATEGY_INVALID_BENCHMARK",
                f"plan.kpi_targets[{index}]",
                "A numeric benchmark needs a target value and a verified citation from the retrieval pack.",
            )

    if plan.budget_mode != brief.external_budget_mode:
        add(
            "STRATEGY_BUDGET_MISMATCH",
            "plan.budget_mode",
            "Plan and brief budget modes must match.",
        )
    if not brief.paid_media_allowed and plan.budget_scenarios:
        add(
            "STRATEGY_BUDGET_MISMATCH",
            "plan.budget_scenarios",
            "Paid-spend scenarios are excluded when paid media is disallowed.",
        )
    approved_maximum = (
        None
        if brief.external_budget_egp is None
        else (
            brief.external_budget_egp
            if isinstance(brief.external_budget_egp, (int, float))
            else brief.external_budget_egp.max_egp
        )
    )
    for index, scenario in enumerate(plan.budget_scenarios or []):
        expected_period = (
            "monthly"
            if brief.external_budget_mode == ExternalBudgetMode.monthly_amount
            else (
                "twelve_week"
                if brief.external_budget_mode
                == ExternalBudgetMode.three_month_amount
                else scenario.period
            )
        )
        if scenario.period != expected_period:
            add(
                "STRATEGY_BUDGET_MISMATCH",
                f"plan.budget_scenarios[{index}].period",
                "Budget scenario period must match the owner-confirmed budget mode.",
            )
        expected_approval = (
            approved_maximum is None or scenario.total_egp > approved_maximum
        )
        if scenario.requires_owner_budget_approval != expected_approval:
            add(
                "STRATEGY_BUDGET_MISMATCH",
                f"plan.budget_scenarios[{index}].requires_owner_budget_approval",
                "Scenarios outside the confirmed budget must be marked for owner budget approval.",
            )
    base_scenario = next(
        (
            scenario
            for scenario in (plan.budget_scenarios or [])
            if scenario.scenario_type == ScenarioType.base
        ),
        None,
    )
    scenario_types = [
        scenario.scenario_type for scenario in (plan.budget_scenarios or [])
    ]
    if plan.budget_mode != ExternalBudgetMode.organic_only and (
        not scenario_types
        or base_scenario is None
        or len(set(scenario_types)) != len(scenario_types)
    ):
        add(
            "STRATEGY_BUDGET_MISMATCH",
            "plan.budget_scenarios",
            "A paid or scenario plan needs one unique base scenario.",
        )
    if (
        brief.external_budget_egp is not None
        and base_scenario is not None
        and (
            (
                isinstance(brief.external_budget_egp, (int, float))
                and base_scenario.total_egp != brief.external_budget_egp
            )
            or (
                isinstance(brief.external_budget_egp, ExternalBudgetRangeEgp)
                and not (
                    brief.external_budget_egp.min_egp
                    <= base_scenario.total_egp
                    <= brief.external_budget_egp.max_egp
                )
            )
        )
    ):
        add(
            "STRATEGY_BUDGET_MISMATCH",
            "plan.budget_scenarios.base.total_egp",
            "The base scenario must equal the owner-confirmed external budget.",
        )

    if any(gap.severity == GapSeverity.blocking for gap in plan.knowledge_gaps):
        add(
            "STRATEGY_KNOWLEDGE_GAP",
            "plan.knowledge_gaps",
            "Blocking knowledge gaps must remain visible and prevent approval.",
        )

    if decision is not None and decision.decision == DecisionType.approved:
        if issues or any(blocker.severity == BlockerSeverity.blocking for blocker in plan.blockers):
            add(
                "STRATEGY_APPROVAL_BLOCKED",
                "decision.decision",
                "A Strategy version with blocking validation issues cannot be approved.",
            )

    return StrategyValidationResult(valid=len(issues) == 0, issues=issues)


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

    @model_validator(mode="after")
    def validate_revision_notes(self) -> "OwnerDecision":
        if self.decision == DecisionType.revision_requested and not (
            self.revision_notes and self.revision_notes.strip()
        ):
            raise ValueError("revision_requested decisions require revision_notes")
        return self


class SubmitStrategyDecisionRequest(BaseModel):
    strategy_version: int = Field(gt=0)
    decision: DecisionType
    revision_notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_revision_notes(self) -> "SubmitStrategyDecisionRequest":
        if self.decision == DecisionType.revision_requested and not (
            self.revision_notes and self.revision_notes.strip()
        ):
            raise ValueError("revision_requested decisions require revision_notes")
        return self


class StrategyResource(BaseModel):
    strategy_id: UUID
    status: StrategyStatus
    brief: Optional[StrategyBrief] = None
    latest_plan: Optional[StrategyPlan] = None


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
