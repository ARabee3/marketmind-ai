from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.core.errors import ErrorBody


UUID = str
IsoDateTime = str
LanguageMode = Literal["ar-EG", "en", "mixed"]
DiscoveryProfileDomain = Literal[
    "identity",
    "offer",
    "customers",
    "differentiation",
    "current_marketing",
    "goals_and_constraints",
    "market_context",
]
DiscoveryCompletionReason = Literal[
    "sufficient",
    "owner_finished_early",
    "turn_limit",
]
AiDiscoveryAction = Literal[
    "ask_next_question",
    "ask_clarification",
    "produce_profile_draft",
    "safe_failure",
]
UncertaintyCategory = Literal[
    "missing_information",
    "contradiction",
    "low_confidence",
    "owner_unknown",
    "research_gap",
    "ambiguous_answer",
]
UncertaintySource = Literal[
    "owner_answer",
    "owner_unknown",
    "research_observation",
    "metadata_extraction",
    "search_result",
    "intake_form",
    "ai_inference",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SocialLinkInput(StrictModel):
    platform: Literal[
        "facebook",
        "instagram",
        "tiktok",
        "website",
        "google_maps",
        "delivery",
        "other",
    ]
    url: str


class PreparedDiscoveryIntake(StrictModel):
    business_name: str
    business_type: str
    city: str
    area: str | None = None
    address_text: str | None = None
    owner_goal_text: str | None = None
    known_competitors_text: str | None = None
    target_audience_text: str | None = None
    notes: str | None = None
    social_links: list[SocialLinkInput] = Field(default_factory=list)


class SourceRef(StrictModel):
    id: UUID
    source_type: Literal["owner_link", "metadata", "search_result", "manual_owner_answer"]
    platform: str | None = None
    url: str | None = None
    title: str | None = None
    snippet: str | None = None
    fetched_at: IsoDateTime | None = None
    confidence: float = Field(ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ResearchObservation(StrictModel):
    id: UUID
    source_ref_id: UUID | None = None
    kind: Literal["digital_presence", "competitor", "market_context", "social_signal", "metadata"]
    statement: str
    confidence: float = Field(ge=0, le=1)
    visibility: Literal["owner_visible", "internal"]
    status: Literal["accepted", "discarded"]
    discard_reason: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_evidence(self) -> "ResearchObservation":
        if self.status == "discarded" and not self.discard_reason:
            raise ValueError("discard_reason is required for discarded observations")
        if (
            self.visibility == "owner_visible"
            and not self.source_ref_id
            and not self.metadata.get("source_label")
        ):
            raise ValueError(
                "owner-visible observations require a source_ref_id or source_label"
            )
        return self


class ConversationHook(StrictModel):
    id: UUID
    source_observation_id: UUID | None = None
    hook_text: str
    language: LanguageMode
    status: Literal["active", "used", "discarded"]


class KnowledgeGap(StrictModel):
    id: UUID
    field_key: str
    question_hint: str
    priority: int
    status: Literal["open", "answered", "skipped"]


class IntelligenceResult(StrictModel):
    status: Literal["running", "partial", "complete", "failed"]
    search_mode: Literal["metadata_only", "free_search", "provider_later"]
    source_refs: list[SourceRef] = Field(default_factory=list)
    research_observations: list[ResearchObservation] = Field(default_factory=list)
    conversation_hooks: list[ConversationHook] = Field(default_factory=list)
    knowledge_gaps: list[KnowledgeGap] = Field(default_factory=list)
    safe_error: dict[str, Any] | None = None


class DiscoveryMessage(StrictModel):
    id: UUID
    role: Literal["owner", "assistant", "system"]
    content: str
    language: LanguageMode
    source: Literal["chat", "research_hook", "summary"]
    suggested_answers: list[str] = Field(default_factory=list, max_length=4)
    created_at: IsoDateTime


class UncertaintyInput(StrictModel):
    domain: DiscoveryProfileDomain
    field_key: str
    description: str
    severity: Literal["low", "medium", "high"]
    category: UncertaintyCategory
    source: UncertaintySource
    source_ref_id: UUID | None = None
    owner_stated_value: str | None = None
    research_suggested_value: str | None = None
    contradiction_detail: str | None = None


class Uncertainty(UncertaintyInput):
    resolved: bool = False
    resolved_at: IsoDateTime | None = None
    resolved_by_action: Literal[
        "owner_clarified",
        "research_confirmed",
        "discarded",
        "skipped",
    ] | None = None


class BusinessIdentityFacts(StrictModel):
    business_name: str | None = None
    business_type: str | None = None
    city: str | None = None
    area: str | None = None


class OfferFacts(StrictModel):
    core_offerings: list[str] = Field(default_factory=list)
    best_sellers: list[str] = Field(default_factory=list)
    price_range: str | None = None
    purchase_occasions: list[str] = Field(default_factory=list)


class CustomerFacts(StrictModel):
    primary_segments: list[str] = Field(default_factory=list)
    visit_or_order_occasions: list[str] = Field(default_factory=list)
    peak_periods: list[str] = Field(default_factory=list)
    customer_needs: list[str] = Field(default_factory=list)


class DifferentiationFacts(StrictModel):
    owner_claimed_strengths: list[str] = Field(default_factory=list)
    customer_choice_reasons: list[str] = Field(default_factory=list)
    proof_points: list[str] = Field(default_factory=list)


class CurrentMarketingFacts(StrictModel):
    active_channels: list[str] = Field(default_factory=list)
    current_activities: list[str] = Field(default_factory=list)
    delivery_platforms: list[str] = Field(default_factory=list)
    available_assets: list[str] = Field(default_factory=list)


class GoalsAndConstraintsFacts(StrictModel):
    growth_goals: list[str] = Field(default_factory=list)
    timeframe: str | None = None
    marketing_budget_range: str | None = None
    team_capacity: str | None = None
    operational_constraints: list[str] = Field(default_factory=list)


class MarketAwareBusinessFacts(StrictModel):
    identity: BusinessIdentityFacts = Field(default_factory=BusinessIdentityFacts)
    offer: OfferFacts = Field(default_factory=OfferFacts)
    customers: CustomerFacts = Field(default_factory=CustomerFacts)
    differentiation: DifferentiationFacts = Field(default_factory=DifferentiationFacts)
    current_marketing: CurrentMarketingFacts = Field(default_factory=CurrentMarketingFacts)
    goals_and_constraints: GoalsAndConstraintsFacts = Field(
        default_factory=GoalsAndConstraintsFacts
    )


class MarketEvidence(StrictModel):
    observation_id: UUID
    source_ref_id: UUID | None = None
    statement: str
    confidence: float = Field(ge=0, le=1)


class MarketContextSnapshot(StrictModel):
    competitor_landscape: list[MarketEvidence] = Field(default_factory=list)
    local_demand_signals: list[MarketEvidence] = Field(default_factory=list)
    digital_presence_signals: list[MarketEvidence] = Field(default_factory=list)
    other_signals: list[MarketEvidence] = Field(default_factory=list)


class DiscoveryDomainScores(StrictModel):
    identity: float = Field(default=0, ge=0, le=1)
    offer: float = Field(default=0, ge=0, le=1)
    customers: float = Field(default=0, ge=0, le=1)
    differentiation: float = Field(default=0, ge=0, le=1)
    current_marketing: float = Field(default=0, ge=0, le=1)
    goals_and_constraints: float = Field(default=0, ge=0, le=1)
    market_context: float = Field(default=0, ge=0, le=1)
    research_confidence: float = Field(default=0, ge=0, le=1)
    profile_readiness: float = Field(default=0, ge=0, le=1)


class DiscoveryReadiness(StrictModel):
    ready: bool
    llm_recommended: bool
    profile_readiness: float = Field(ge=0, le=1)
    domain_scores: DiscoveryDomainScores
    blocking_domains: list[DiscoveryProfileDomain] = Field(default_factory=list)
    owner_turn_count: int = Field(ge=0)
    max_owner_turns: int = Field(gt=0)
    completion_reason: DiscoveryCompletionReason | None = None


class DiscoveryCompletionContext(StrictModel):
    reason: DiscoveryCompletionReason
    completeness: Literal["complete", "incomplete"]
    readiness: DiscoveryReadiness


class BusinessProfileDraft(StrictModel):
    id: UUID
    session_id: UUID
    version: int
    status: Literal["draft", "ready_for_confirmation", "confirmed", "superseded"]
    completeness: Literal["complete", "incomplete"]
    completion_reason: DiscoveryCompletionReason
    readiness: DiscoveryReadiness
    confirmed_facts: MarketAwareBusinessFacts
    market_context: MarketContextSnapshot
    research_observations: list[ResearchObservation]
    uncertainties: list[Uncertainty]
    owner_goals: list[str]
    strategy_relevant_notes: list[str]
    raw_ai_output: dict[str, Any]


class AiDiscoveryStartRequest(StrictModel):
    session_id: UUID
    language_mode: LanguageMode
    intake: PreparedDiscoveryIntake
    intelligence: IntelligenceResult


class AiDiscoveryRespondRequest(StrictModel):
    session_id: UUID
    language_mode: LanguageMode
    intake: PreparedDiscoveryIntake
    intelligence: IntelligenceResult
    messages: list[DiscoveryMessage]
    owner_message: DiscoveryMessage


class AiDiscoverySummarizeRequest(StrictModel):
    session_id: UUID
    language_mode: LanguageMode
    intake: PreparedDiscoveryIntake
    intelligence: IntelligenceResult
    messages: list[DiscoveryMessage]
    completion_context: DiscoveryCompletionContext


class DiscoveryModelOutput(StrictModel):
    action: AiDiscoveryAction
    next_question: str | None = None
    suggested_answers: list[str] = Field(default_factory=list, max_length=4)
    updated_known_facts: MarketAwareBusinessFacts
    updated_uncertainties: list[UncertaintyInput]
    owner_goals: list[str] = Field(default_factory=list)
    strategy_relevant_notes: list[str] = Field(default_factory=list)
    domain_scores: DiscoveryDomainScores
    ready_to_summarize: bool

    @field_validator("suggested_answers")
    @classmethod
    def normalize_suggested_answers(cls, value: list[str]) -> list[str]:
        return _clean_suggested_answers(value)

    @model_validator(mode="after")
    def validate_action_payload(self) -> "DiscoveryModelOutput":
        if self.action in {"ask_next_question", "ask_clarification"} and not self.next_question:
            raise ValueError("next_question is required for question actions")
        return self


class AiDiscoveryResult(StrictModel):
    action: AiDiscoveryAction
    next_question: str | None = None
    suggested_answers: list[str] = Field(default_factory=list, max_length=4)
    updated_known_facts: MarketAwareBusinessFacts
    updated_uncertainties: list[UncertaintyInput]
    research_observations: list[ResearchObservation]
    source_refs: list[SourceRef]
    domain_scores: DiscoveryDomainScores
    ready_to_summarize: bool
    profile_draft: BusinessProfileDraft | None = None
    safe_error: ErrorBody | None = None


def _clean_suggested_answers(value: list[str]) -> list[str]:
    cleaned: list[str] = []
    for answer in value:
        normalized = answer.strip()
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
    return cleaned[:4]
