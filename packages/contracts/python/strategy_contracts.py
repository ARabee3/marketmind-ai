"""
Strategy Contracts — Pydantic v2 models for MarketMind AI.

Cross-language parity with packages/contracts/src/strategy/*.ts.
Round-trips against JSON fixtures under packages/contracts/examples/.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Optional, Literal, Union

UUID = str

from pydantic import BaseModel, Field, model_validator

from content_base import ContentChannel, ContentFormat


CHANNEL_SCORE_RULE_VERSION = "strategy-channel-score-v1"

CHANNEL_SCORE_DIMENSIONS = (
    "objective_fit",
    "audience_fit",
    "existing_presence",
    "asset_format_fit",
    "team_capacity",
    "budget_fit",
    "evidence_strength",
    "measurement_readiness",
)


def round_score(value: float) -> float:
    return round(value * 100) / 100


def calculate_channel_total(scorecard: "DeterministicChannelScorecard") -> float:
    return round_score(
        sum(getattr(scorecard.scores, dimension) for dimension in CHANNEL_SCORE_DIMENSIONS)
    )


def scorecards_match(
    a: "DeterministicChannelScorecard",
    b: "DeterministicChannelScorecard",
) -> bool:
    return (
        a.channel == b.channel
        and a.role == b.role
        and all(
            getattr(a.scores, dimension) == getattr(b.scores, dimension)
            for dimension in CHANNEL_SCORE_DIMENSIONS
        )
        and a.total_score == b.total_score
        and a.excluded_reason == b.excluded_reason
    )


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
    market_tier: str = "egypt"
    is_fallback: bool = False
    fallback_label: Optional[str] = None


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
# Strategy v2 — owner-first contracts
# ---------------------------------------------------------------------------

STRATEGY_V2_CHANNELS = (
    "facebook",
    "instagram",
    "tiktok",
    "google_business_profile",
    "delivery_platforms",
    "website",
)

CONTENT_SUPPORTED_V2_CHANNELS = frozenset(
    ("facebook", "instagram", "tiktok", "google_business_profile")
)


class StrategyV2Channel(str, Enum):
    facebook = "facebook"
    instagram = "instagram"
    tiktok = "tiktok"
    google_business_profile = "google_business_profile"
    delivery_platforms = "delivery_platforms"
    website = "website"


class ChannelSetupState(str, Enum):
    connected = "connected"
    existing_link = "existing_link"
    setup_later = "setup_later"


class ChannelCapabilityState(str, Enum):
    publishing_ready = "publishing_ready"
    publishing_pending = "publishing_pending"
    owner_managed = "owner_managed"


class StrategyWeeklyCapacityPreset(str, Enum):
    one_to_two_hours = "one_to_two_hours"
    three_to_five_hours = "three_to_five_hours"
    half_day = "half_day"
    full_day_plus = "full_day_plus"


class OwnerAdviceCategory(str, Enum):
    channel_setup = "channel_setup"
    audience = "audience"
    content = "content"
    budget = "budget"
    measurement = "measurement"
    capability = "capability"


class StrategyChannelChoice(BaseModel):
    channel: StrategyV2Channel
    role: ChannelRole
    setup_state: ChannelSetupState
    public_url: Optional[str] = None
    publishing_target_id: Optional[UUID] = None
    note: Optional[str] = None

    @model_validator(mode="after")
    def validate_setup_consistency(self) -> "StrategyChannelChoice":
        if self.setup_state != ChannelSetupState.existing_link:
            if self.public_url and self.public_url.strip():
                raise ValueError(
                    "public_url is only allowed for an existing_link setup state"
                )
        elif not (self.public_url and self.public_url.strip()):
            raise ValueError(
                "an existing_link choice requires an owner-managed public URL"
            )
        if self.setup_state != ChannelSetupState.connected and self.publishing_target_id:
            raise ValueError(
                "publishing_target_id is only allowed for a connected setup state"
            )
        return self


class StrategyBriefV2(BaseModel):
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
    weekly_capacity: StrategyWeeklyCapacityPreset
    weekly_capacity_note: Optional[str] = None
    channel_choices: list[StrategyChannelChoice]
    constraints: list[str]
    clarification_answers: list[StrategyClarification]
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_brief_v2(self) -> "StrategyBriefV2":
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
        if not (1 <= len(self.channel_choices) <= 3):
            raise ValueError("channel_choices must contain 1 to 3 channels")
        if len({choice.channel for choice in self.channel_choices}) != len(
            self.channel_choices
        ):
            raise ValueError("channel_choices must be unique")
        primary_count = sum(
            1 for choice in self.channel_choices if choice.role == ChannelRole.primary
        )
        if primary_count != 1:
            raise ValueError("channel_choices must have exactly one primary channel")
        supporting_count = sum(
            1 for choice in self.channel_choices if choice.role == ChannelRole.supporting
        )
        if supporting_count > 2:
            raise ValueError("channel_choices may have at most two supporting channels")
        return self


class StrategyV2CalendarWeek(BaseModel):
    week_number: int = Field(ge=1, le=12)
    focus: str = Field(min_length=1)
    expected_outcome: str = Field(min_length=1)
    measurement_check: str = Field(min_length=1)
    formats: list[str] = Field(min_length=1)


class OwnerAdviceItem(BaseModel):
    id: UUID
    week_number: int = Field(ge=0, le=12)
    category: OwnerAdviceCategory
    action: str = Field(min_length=1)
    why_it_matters: str = Field(min_length=1)
    timing: str = Field(min_length=1)
    source: SourcedClaim


class OwnerAdviceWeek(BaseModel):
    week_number: int = Field(ge=1, le=12)
    items: list[OwnerAdviceItem]


class OwnerAdvice(BaseModel):
    before_week_1: list[OwnerAdviceItem]
    weeks: list[OwnerAdviceWeek]

    @model_validator(mode="after")
    def validate_advice_structure(self) -> "OwnerAdvice":
        if any(item.week_number != 0 for item in self.before_week_1):
            raise ValueError("before_week_1 items must carry week_number 0")
        if len(self.weeks) != 12:
            raise ValueError("owner advice must have 12 week buckets")
        if {week.week_number for week in self.weeks} != set(range(1, 13)):
            raise ValueError(
                "owner advice must contain each week number from 1 through 12 exactly once"
            )
        for group in self.weeks:
            for item in group.items:
                if item.week_number != group.week_number:
                    raise ValueError(
                        f"advice item in week {group.week_number} must carry week_number {group.week_number}"
                    )
        return self


class ChannelCommitment(BaseModel):
    channel: StrategyV2Channel
    role: ChannelRole
    setup_state: ChannelSetupState
    capability_state: ChannelCapabilityState
    rationale: SourcedClaim


class ContentHandoffWeek(BaseModel):
    week_number: int = Field(ge=1, le=12)
    formats: list[ContentFormat] = Field(min_length=1)


class ContentHandoffAvailable(BaseModel):
    available: Literal[True] = True
    channels: list[ContentChannel] = Field(min_length=1)
    language: LanguageMode
    weeks: list[ContentHandoffWeek]

    @model_validator(mode="after")
    def validate_handoff_weeks(self) -> "ContentHandoffAvailable":
        if len(self.weeks) != 12:
            raise ValueError("a usable content handoff must contain all twelve weeks")
        if {week.week_number for week in self.weeks} != set(range(1, 13)):
            raise ValueError(
                "handoff weeks must contain each week number from 1 through 12 exactly once"
            )
        return self


class ContentHandoffUnavailable(BaseModel):
    available: Literal[False] = False
    reason: Literal["no_content_supported_channels", "incomplete_weekly_formats"]
    message: str = Field(min_length=1)


ContentHandoff = Annotated[
    Union[ContentHandoffAvailable, ContentHandoffUnavailable],
    Field(discriminator="available"),
]


class StrategyPlanV2(BaseModel):
    meta: Optional[dict[str, Any]] = None
    id: UUID
    strategy_id: UUID
    version: int = Field(gt=0)
    contract_version: Literal["strategy-v2"] = "strategy-v2"
    brief_id: UUID
    profile_version: BusinessProfileVersionRef
    retrieval_run_id: UUID
    goal: SourcedClaim
    primary_objective: StrategyObjective
    funnel_stage: str
    plan_language: LanguageMode
    start_date: datetime
    calendar_weeks: list[StrategyV2CalendarWeek]
    owner_advice: OwnerAdvice
    channel_commitments: list[ChannelCommitment]
    evidence_summary: SourcedClaim
    risks: list[SourcedClaim]
    knowledge_gaps: list[KnowledgeGapItem]
    blockers: list[StrategyBlocker]
    citations: list[PlanCitation]
    content_handoff: ContentHandoff
    created_at: datetime

    @model_validator(mode="after")
    def validate_plan_v2(self) -> "StrategyPlanV2":
        if len(self.calendar_weeks) != 12:
            raise ValueError("calendar_weeks must have exactly 12 entries")
        if {week.week_number for week in self.calendar_weeks} != set(range(1, 13)):
            raise ValueError(
                "calendar_weeks must contain each week number from 1 through 12 exactly once"
            )
        return self


class UpdateStrategyBriefV2Request(BaseModel):
    business_profile_version: BusinessProfileVersionRef
    primary_objective: StrategyObjective
    start_date: datetime
    plan_language: LanguageMode
    paid_media_allowed: bool
    external_budget_mode: ExternalBudgetMode
    external_budget_egp: Optional[float | ExternalBudgetRangeEgp] = None
    weekly_capacity: StrategyWeeklyCapacityPreset
    weekly_capacity_note: Optional[str] = None
    channel_choices: list[StrategyChannelChoice]
    constraints: list[str]
    clarification_answers: list[StrategyClarification]

    @model_validator(mode="after")
    def validate_budget_and_choices(self) -> "UpdateStrategyBriefV2Request":
        StrategyBriefV2(
            id="00000000-0000-4000-8000-000000000000",
            strategy_id="00000000-0000-4000-8000-000000000001",
            created_at=datetime.min,
            updated_at=datetime.min,
            **self.model_dump(),
        )
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
    contract_version: Literal["strategy-v1", "strategy-v2"]
    strategy_id: UUID
    brief: StrategyBrief | StrategyBriefV2
    query_context: RetrievalQueryContext


class StrategyGenerateRequest(BaseModel):
    contract_version: Literal["strategy-v1", "strategy-v2"]
    strategy_id: UUID
    business_profile: BusinessProfilePayload
    brief: StrategyBrief | StrategyBriefV2
    retrieved_knowledge_pack: RetrievedKnowledgePack
    deterministic_channel_scores: list[DeterministicChannelScorecard]


class StrategyReviseRequest(StrategyGenerateRequest):
    previous_plan: StrategyPlan | StrategyPlanV2
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
    "STRATEGY_LANGUAGE_MISMATCH",
    "STRATEGY_APPROVAL_BLOCKED",
    "STRATEGY_CHANNEL_CHOICE_MISMATCH",
    "STRATEGY_CONTENT_HANDOFF_INVALID",
]


class StrategyValidationIssue(BaseModel):
    code: StrategyValidationCode
    field: str
    message: str


class StrategyValidationResult(BaseModel):
    valid: bool
    issues: list[StrategyValidationIssue]


class StrategyGenerateResponse(BaseModel):
    plan: StrategyPlan | StrategyPlanV2
    validation: StrategyValidationResult


def _naive_datetime(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


CONTENT_AGENT_LEAKAGE_PATTERNS = (
    re.compile(r"#\w+", re.UNICODE),
    re.compile(r"\bCaption\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bScript\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bPost\s*\d+\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bStory\s*\d+\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bReel\s*\d+\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\b(?:caption|script|post|story|reel)\b", re.IGNORECASE | re.UNICODE),
)

EXECUTION_LANGUAGE_PATTERNS = (
    re.compile(r"\bscheduled\s+for\s+publishing\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bads?\s+have\s+been\s+launched\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bbudget\s+has\s+been\s+spent\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bhas\s+been\s+published\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bwe\s+will\s+run\s+the\s+ads?\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bauto-?approve\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?:تم|هيتم|هننشر|انشر).*(?:نشر|بوست|إعلان)", re.UNICODE),
)

PAID_TACTIC_PATTERNS = (
    re.compile(r"\bboost(?:ed|ing)?\s+posts?\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bpaid\s+(?:ads?|campaign|media|promotion)\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bsponsored\s+(?:post|promotion|ad)\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bad\s+budget\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?:إعلان|اعلان|بوست|منشور)\s+ممول", re.UNICODE),
    re.compile(r"(?:هنشغل|تشغيل|إطلاق|اطلاق).*(?:إعلانات|اعلانات)", re.UNICODE),
    re.compile(r"ميزانية\s+(?:إعلانات|اعلانات)", re.UNICODE),
)


def _claim_texts(plan: StrategyPlan) -> list[tuple[str, str]]:
    claims = [
        ("executive_summary", plan.executive_summary.text),
        ("situation_diagnosis", plan.situation_diagnosis.text),
        ("target_audience", plan.target_audience.text),
        ("positioning", plan.positioning.text),
        ("tone", plan.tone.text),
    ]
    for index, claim in enumerate(plan.assumptions):
        claims.append((f"assumptions[{index}]", claim.text))
    for index, claim in enumerate(plan.risks):
        claims.append((f"risks[{index}]", claim.text))
    for index, pillar in enumerate(plan.content_strategy.pillars):
        claims.append((f"content_strategy.pillars[{index}]", pillar.text))
    for index, mix in enumerate(plan.content_strategy.format_mix):
        claims.append((f"content_strategy.format_mix[{index}]", mix.text))
    return claims


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

    if not business_profile.confirmed_at or not business_profile.confirmed_by_user_id:
        add(
            "STRATEGY_PROFILE_UNCONFIRMED",
            "business_profile",
            "Strategy requires a confirmed immutable Business Profile.",
        )

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
    if (
        decision is not None
        and decision.decision == DecisionType.revision_requested
        and not (decision.revision_notes and decision.revision_notes.strip())
    ):
        add(
            "STRATEGY_RULE_VIOLATION",
            "decision.revision_notes",
            "A revision request must explain what the owner wants changed.",
        )

    retrieved_at = _naive_datetime(retrieval_pack.retrieved_at)

    for index, item in enumerate(retrieval_pack.items):
        quality = item.source_quality
        effective_at = _naive_datetime(quality.effective_at)
        expires_at = (
            _naive_datetime(quality.expires_at)
            if quality.expires_at is not None
            else None
        )
        unavailable = (
            quality.review_status != "approved"
            or effective_at > retrieved_at
            or (expires_at is not None and expires_at < retrieved_at)
        )
        if unavailable:
            add(
                "STRATEGY_EVIDENCE_NOT_APPROVED",
                f"retrieval_pack.items[{index}].source_quality",
                "Retrieved knowledge must be approved, effective, and unexpired.",
            )

    deterministic_names = [score.channel for score in deterministic_channel_scores]

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

    if plan.channel_score_rule_version != CHANNEL_SCORE_RULE_VERSION:
        add(
            "STRATEGY_SCORE_MISMATCH",
            "plan.channel_score_rule_version",
            "Unsupported deterministic channel score rule version.",
        )

    all_score_channels = [scorecard.channel for scorecard in plan.all_channel_scores]
    selected_channels = [scorecard.channel for scorecard in plan.selected_channels]
    if (
        len(set(deterministic_names)) != len(deterministic_names)
        or len(set(all_score_channels)) != len(all_score_channels)
        or len(set(selected_channels)) != len(selected_channels)
    ):
        add(
            "STRATEGY_SCORE_MISMATCH",
            "plan.selected_channels",
            "Deterministic, all-channel, and selected-channel lists must use unique channel names.",
        )

    for index, scorecard in enumerate(plan.all_channel_scores):
        dimensions_valid = all(
            math.isfinite(getattr(scorecard.scores, dimension))
            and 0 <= getattr(scorecard.scores, dimension) <= 1
            for dimension in CHANNEL_SCORE_DIMENSIONS
        )
        if (
            not dimensions_valid
            or calculate_channel_total(scorecard) != scorecard.total_score
        ):
            add(
                "STRATEGY_SCORE_MISMATCH",
                f"plan.all_channel_scores[{index}]",
                "Channel total must be reproducible from eight bounded deterministic dimensions.",
            )

    if (
        len(deterministic_channel_scores) != len(plan.all_channel_scores)
        or any(
            not (
                actual := next(
                    (
                        scorecard
                        for scorecard in plan.all_channel_scores
                        if scorecard.channel == expected.channel
                    ),
                    None,
                )
            )
            or not scorecards_match(expected, actual)
            for expected in deterministic_channel_scores
        )
    ):
        add(
            "STRATEGY_SCORE_MISMATCH",
            "plan.all_channel_scores",
            "The plan must preserve the deterministic channel score input unchanged.",
        )

    for index, selected in enumerate(plan.selected_channels):
        canonical = next(
            (
                scorecard
                for scorecard in plan.all_channel_scores
                if scorecard.channel == selected.channel
            ),
            None,
        )
        if canonical is None or not scorecards_match(selected, canonical):
            add(
                "STRATEGY_SCORE_MISMATCH",
                f"plan.selected_channels[{index}]",
                "Selected channels must exactly reuse deterministic all-channel results.",
            )

    primary_count = sum(
        1 for channel in plan.selected_channels if channel.role == ChannelRole.primary
    )
    supporting_count = sum(
        1
        for channel in plan.selected_channels
        if channel.role == ChannelRole.supporting
    )
    if primary_count > 2 or supporting_count > 1:
        add(
            "STRATEGY_CHANNEL_LIMIT_EXCEEDED",
            "plan.selected_channels",
            "A plan may contain at most two primary and one supporting channel.",
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
        amount_total = round_score(
            sum(allocation.amount_egp for allocation in scenario.channel_allocations)
        )
        percentage_total = round_score(
            sum(allocation.percentage for allocation in scenario.channel_allocations)
        )
        if amount_total != scenario.total_egp or percentage_total != 100:
            add(
                "STRATEGY_ARITHMETIC_FAILURE",
                f"plan.budget_scenarios[{index}].channel_allocations",
                "Allocations must equal the scenario total and percentages must equal 100.",
            )
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

    week_numbers = [week.week_number for week in plan.content_strategy.weeks]
    if (
        len(week_numbers) != 12
        or len(set(week_numbers)) != 12
        or any(week < 1 or week > 12 for week in week_numbers)
    ):
        add(
            "STRATEGY_RULE_VIOLATION",
            "plan.content_strategy.weeks",
            "The roadmap must contain each week number from 1 through 12 exactly once.",
        )

    if any(gap.severity == GapSeverity.blocking for gap in plan.knowledge_gaps):
        add(
            "STRATEGY_KNOWLEDGE_GAP",
            "plan.knowledge_gaps",
            "Blocking knowledge gaps must remain visible and prevent approval.",
        )

    for field, text in _claim_texts(plan):
        if any(pattern.search(text) for pattern in CONTENT_AGENT_LEAKAGE_PATTERNS):
            add(
                "STRATEGY_RULE_VIOLATION",
                field,
                "Strategy planning text must not contain finished captions, scripts, posts, or hashtags.",
            )
        if any(pattern.search(text) for pattern in EXECUTION_LANGUAGE_PATTERNS):
            add(
                "STRATEGY_RULE_VIOLATION",
                field,
                "Strategy planning text must not imply publishing, ad execution, spending, or auto-approval.",
            )
        if not brief.paid_media_allowed and any(
            pattern.search(text) for pattern in PAID_TACTIC_PATTERNS
        ):
            add(
                "STRATEGY_RULE_VIOLATION",
                field,
                "Paid tactics are not allowed when paid_media_allowed is false.",
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
    brief: Optional[StrategyBrief | StrategyBriefV2] = None
    latest_plan: Optional[StrategyPlan | StrategyPlanV2] = None


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


# ---------------------------------------------------------------------------
# Strategy v2 — cross-object policy validation (mirror of strategy-policy.ts)
# ---------------------------------------------------------------------------


def validate_strategy_brief_v2_choices(brief: StrategyBriefV2) -> list[StrategyValidationIssue]:
    """Validate the brief's channel-choice invariants (1-3 unique, one primary)."""
    issues: list[StrategyValidationIssue] = []

    def add(code: StrategyValidationCode, field: str, message: str) -> None:
        issues.append(StrategyValidationIssue(code=code, field=field, message=message))

    choices = brief.channel_choices
    if not (1 <= len(choices) <= 3):
        add(
            "STRATEGY_CHANNEL_CHOICE_MISMATCH",
            "brief.channel_choices",
            "An owner-first brief must contain 1 to 3 unique channel choices.",
        )
        return issues

    if len({choice.channel for choice in choices}) != len(choices):
        add(
            "STRATEGY_CHANNEL_CHOICE_MISMATCH",
            "brief.channel_choices",
            "Channel choices must be unique.",
        )
    primary_count = sum(1 for choice in choices if choice.role == ChannelRole.primary)
    if primary_count != 1:
        add(
            "STRATEGY_CHANNEL_CHOICE_MISMATCH",
            "brief.channel_choices",
            "Exactly one primary channel must be selected.",
        )
    supporting_count = sum(
        1 for choice in choices if choice.role == ChannelRole.supporting
    )
    if supporting_count > 2:
        add(
            "STRATEGY_CHANNEL_CHOICE_MISMATCH",
            "brief.channel_choices",
            "At most two supporting channels may be selected.",
        )

    for index, choice in enumerate(choices):
        if choice.setup_state != ChannelSetupState.existing_link and (
            choice.public_url and choice.public_url.strip()
        ):
            add(
                "STRATEGY_CHANNEL_CHOICE_MISMATCH",
                f"brief.channel_choices[{index}].public_url",
                "A public URL is only allowed for an existing_link setup state.",
            )
        if choice.setup_state != ChannelSetupState.connected and (
            choice.publishing_target_id
        ):
            add(
                "STRATEGY_CHANNEL_CHOICE_MISMATCH",
                f"brief.channel_choices[{index}].publishing_target_id",
                "A publishing target is only allowed for a connected setup state.",
            )

    if not (1 <= len(choices) <= 3):
        return issues
    if not isinstance(brief.weekly_capacity, StrategyWeeklyCapacityPreset):
        add(
            "STRATEGY_RULE_VIOLATION",
            "brief.weekly_capacity",
            f"Unsupported weekly capacity preset '{brief.weekly_capacity}'.",
        )
    return issues


def _claim_texts_v2(plan: StrategyPlanV2) -> list[tuple[str, str]]:
    claims = [
        ("goal", plan.goal.text),
        ("evidence_summary", plan.evidence_summary.text),
    ]
    for index, commitment in enumerate(plan.channel_commitments):
        claims.append((f"channel_commitments[{index}].rationale", commitment.rationale.text))
    for index, item in enumerate(plan.owner_advice.before_week_1):
        claims.append((f"owner_advice.before_week_1[{index}].source", item.source.text))
    for group_index, group in enumerate(plan.owner_advice.weeks):
        for index, item in enumerate(group.items):
            claims.append(
                (f"owner_advice.weeks[{group_index}].items[{index}].source", item.source.text)
            )
    for index, claim in enumerate(plan.risks):
        claims.append((f"risks[{index}]", claim.text))
    return claims


def validate_strategy_v2_bundle(
    *,
    business_profile: BusinessProfilePayload,
    brief: StrategyBriefV2,
    retrieval_pack: RetrievedKnowledgePack,
    plan: StrategyPlanV2,
    decision: Optional["OwnerDecision"] = None,
) -> StrategyValidationResult:
    """Cross-object policy validation for owner-first strategy-v2 plans.

    Mirrors validate_strategy_v2_bundle in packages/contracts/src/strategy/
    strategy-policy.ts. The v2 invariant: every generated channel commitment
    must match an owner choice and no extra choice may appear.
    """
    issues: list[StrategyValidationIssue] = []

    def add(code: StrategyValidationCode, field: str, message: str) -> None:
        issues.append(StrategyValidationIssue(code=code, field=field, message=message))

    if not business_profile.confirmed_at or not business_profile.confirmed_by_user_id:
        add(
            "STRATEGY_PROFILE_UNCONFIRMED",
            "business_profile",
            "Strategy requires a confirmed immutable Business Profile.",
        )

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
    if decision and (
        decision.strategy_id != plan.strategy_id
        or decision.strategy_version != plan.version
    ):
        add(
            "STRATEGY_RULE_VIOLATION",
            "decision.strategy_version",
            "An owner decision must reference the exact immutable Strategy version being reviewed.",
        )
    if decision and decision.decision == "revision_requested" and not (
        decision.revision_notes or "").strip():
        add(
            "STRATEGY_RULE_VIOLATION",
            "decision.revision_notes",
            "A revision request must explain what the owner wants changed.",
        )

    retrieved_at = retrieval_pack.retrieved_at
    for index, item in enumerate(retrieval_pack.items):
        unavailable = (
            item.source_quality.review_status != "approved"
            or item.source_quality.effective_at > retrieved_at
            or (
                item.source_quality.expires_at is not None
                and item.source_quality.expires_at < retrieved_at
            )
        )
        if unavailable:
            add(
                "STRATEGY_EVIDENCE_NOT_APPROVED",
                f"retrieval_pack.items[{index}].source_quality",
                "Retrieved knowledge must be approved, effective, and unexpired.",
            )

    pack_items_by_chunk = {item.chunk_id: item for item in retrieval_pack.items}
    for index, citation in enumerate(plan.citations):
        item = pack_items_by_chunk.get(citation.chunk_id)
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

    if plan.plan_language != brief.plan_language:
        add(
            "STRATEGY_LANGUAGE_MISMATCH",
            "plan.plan_language",
            "Plan and brief plan languages must match.",
        )

    issues.extend(validate_strategy_brief_v2_choices(brief))

    # Channel commitments must match the owner's choices exactly.
    choices = brief.channel_choices
    commitments = plan.channel_commitments
    if len(commitments) != len(choices):
        add(
            "STRATEGY_CHANNEL_CHOICE_MISMATCH",
            "plan.channel_commitments",
            "The plan must commit to exactly the owner-selected channels — no added and no dropped choices.",
        )
    else:
        for index, (commitment, choice) in enumerate(zip(commitments, choices)):
            if (
                commitment.channel != choice.channel
                or commitment.role != choice.role
                or commitment.setup_state != choice.setup_state
            ):
                add(
                    "STRATEGY_CHANNEL_CHOICE_MISMATCH",
                    f"plan.channel_commitments[{index}]",
                    "Every commitment must match an owner choice (channel, role, setup state) in the same order.",
                )
                continue
            if not (commitment.rationale and commitment.rationale.text.strip()):
                add(
                    "STRATEGY_RULE_VIOLATION",
                    f"plan.channel_commitments[{index}].rationale",
                    "Each channel commitment needs a plain-language rationale.",
                )
            if commitment.capability_state == ChannelCapabilityState.publishing_ready and (
                choice.setup_state != ChannelSetupState.connected
                or not choice.publishing_target_id
            ):
                add(
                    "STRATEGY_CHANNEL_CHOICE_MISMATCH",
                    f"plan.channel_commitments[{index}].capability_state",
                    "Publishing-ready requires a connected channel with a verified publishing target.",
                )
            if commitment.capability_state == ChannelCapabilityState.publishing_pending and (
                choice.setup_state != ChannelSetupState.connected
            ):
                add(
                    "STRATEGY_CHANNEL_CHOICE_MISMATCH",
                    f"plan.channel_commitments[{index}].capability_state",
                    "Publishing-pending requires a connected channel whose target is not yet verified.",
                )
            if commitment.capability_state == ChannelCapabilityState.owner_managed and (
                choice.setup_state == ChannelSetupState.connected
            ):
                add(
                    "STRATEGY_CHANNEL_CHOICE_MISMATCH",
                    f"plan.channel_commitments[{index}].capability_state",
                    "A connected channel is never owner-managed.",
                )

    week_numbers = [week.week_number for week in plan.calendar_weeks]
    if len(week_numbers) != 12 or len(set(week_numbers)) != 12 or any(
        week < 1 or week > 12 for week in week_numbers
    ):
        add(
            "STRATEGY_RULE_VIOLATION",
            "plan.calendar_weeks",
            "The plan must contain each week number 1 through 12 exactly once.",
        )
    for index, week in enumerate(plan.calendar_weeks):
        for field in ("focus", "expected_outcome", "measurement_check"):
            if not (getattr(week, field) or "").strip():
                add(
                    "STRATEGY_RULE_VIOLATION",
                    f"plan.calendar_weeks[{index}].{field}",
                    "Calendar week fields must be non-empty.",
                )
        if not week.formats:
            add(
                "STRATEGY_CONTENT_HANDOFF_INVALID",
                f"plan.calendar_weeks[{index}].formats",
                "Every calendar week must declare at least one format label.",
            )

    if any(item.week_number != 0 for item in plan.owner_advice.before_week_1):
        add(
            "STRATEGY_RULE_VIOLATION",
            "plan.owner_advice.before_week_1",
            "Before week 1 advice items must carry week_number 0.",
        )
    advice_week_numbers = [group.week_number for group in plan.owner_advice.weeks]
    if len(advice_week_numbers) != 12 or len(set(advice_week_numbers)) != 12 or any(
        week < 1 or week > 12 for week in advice_week_numbers
    ):
        add(
            "STRATEGY_RULE_VIOLATION",
            "plan.owner_advice.weeks",
            "Owner advice must contain one collection for each week 1 through 12.",
        )

    # Content handoff must be a complete, deterministic content-v1 projection.
    handoff = plan.content_handoff
    if isinstance(handoff, ContentHandoffUnavailable):
        if handoff.reason not in (
            "no_content_supported_channels",
            "incomplete_weekly_formats",
        ) or not handoff.message.strip():
            add(
                "STRATEGY_CONTENT_HANDOFF_INVALID",
                "plan.content_handoff",
                "An unavailable handoff needs a machine-readable reason and message.",
            )
    else:
        if not handoff.channels or any(
            channel not in CONTENT_SUPPORTED_V2_CHANNELS for channel in handoff.channels
        ):
            add(
                "STRATEGY_CONTENT_HANDOFF_INVALID",
                "plan.content_handoff.channels",
                "Handoff channels must be non-empty existing ContentChannel values.",
            )
        committed_channels = {c.channel for c in plan.channel_commitments}
        for channel in handoff.channels:
            if channel not in committed_channels:
                add(
                    "STRATEGY_CONTENT_HANDOFF_INVALID",
                    "plan.content_handoff.channels",
                    f"Handoff channel '{channel}' is not an owner-selected channel.",
                )
        if len(handoff.weeks) != 12:
            add(
                "STRATEGY_CONTENT_HANDOFF_INVALID",
                "plan.content_handoff.weeks",
                "A usable content handoff must contain all twelve week mappings.",
            )
        else:
            handoff_week_numbers = [week.week_number for week in handoff.weeks]
            if len(set(handoff_week_numbers)) != 12 or any(
                week < 1 or week > 12 for week in handoff_week_numbers
            ):
                add(
                    "STRATEGY_CONTENT_HANDOFF_INVALID",
                    "plan.content_handoff.weeks",
                    "Handoff weeks must contain each week number 1 through 12 exactly once.",
                )
            for index, week in enumerate(handoff.weeks):
                if not week.formats or any(
                    format not in ("static_image_post", "short_video_script", "carousel_brief", "text_post")
                    for format in week.formats
                ):
                    add(
                        "STRATEGY_CONTENT_HANDOFF_INVALID",
                        f"plan.content_handoff.weeks[{index}].formats",
                        "Week formats must be non-empty exact content-v1 format values.",
                    )
                if len(set(week.formats)) != len(week.formats):
                    add(
                        "STRATEGY_CONTENT_HANDOFF_INVALID",
                        f"plan.content_handoff.weeks[{index}].formats",
                        "Week formats must be unique.",
                    )

    if any(gap.severity == GapSeverity.blocking for gap in plan.knowledge_gaps):
        add(
            "STRATEGY_KNOWLEDGE_GAP",
            "plan.knowledge_gaps",
            "Blocking knowledge gaps must remain visible and prevent approval.",
        )

    for field, text in _claim_texts_v2(plan):
        if any(pattern.search(text) for pattern in CONTENT_AGENT_LEAKAGE_PATTERNS):
            add(
                "STRATEGY_RULE_VIOLATION",
                field,
                "Strategy planning text must not contain finished captions, scripts, posts, or hashtags.",
            )
        if any(pattern.search(text) for pattern in EXECUTION_LANGUAGE_PATTERNS):
            add(
                "STRATEGY_RULE_VIOLATION",
                field,
                "Strategy planning text must not imply publishing, ad execution, spending, or auto-approval.",
            )
        if not brief.paid_media_allowed and any(
            pattern.search(text) for pattern in PAID_TACTIC_PATTERNS
        ):
            add(
                "STRATEGY_RULE_VIOLATION",
                field,
                "Paid tactics are not allowed when paid_media_allowed is false.",
            )

    if decision and decision.decision == "approved" and (
        issues or any(blocker.severity == BlockerSeverity.blocking for blocker in plan.blockers)
    ):
        add(
            "STRATEGY_APPROVAL_BLOCKED",
            "decision.decision",
            "A Strategy version with blocking validation issues cannot be approved.",
        )

    return StrategyValidationResult(valid=len(issues) == 0, issues=issues)


def validate_strategy_plan_bundle(
    *,
    business_profile: BusinessProfilePayload,
    brief: StrategyBrief | StrategyBriefV2,
    retrieval_pack: RetrievedKnowledgePack,
    deterministic_channel_scores: list[DeterministicChannelScorecard],
    plan: StrategyPlan | StrategyPlanV2,
    decision: Optional["OwnerDecision"] = None,
) -> StrategyValidationResult:
    """Dispatch a bundle to the validator matching the plan's contract version."""
    if plan.contract_version == "strategy-v2" and isinstance(plan, StrategyPlanV2):
        return validate_strategy_v2_bundle(
            business_profile=business_profile,
            brief=brief,  # type: ignore[arg-type]
            retrieval_pack=retrieval_pack,
            plan=plan,
            decision=decision,
        )
    return validate_strategy_bundle(
        business_profile=business_profile,
        brief=brief,  # type: ignore[arg-type]
        retrieval_pack=retrieval_pack,
        deterministic_channel_scores=deterministic_channel_scores,
        plan=plan,  # type: ignore[arg-type]
        decision=decision,
    )
