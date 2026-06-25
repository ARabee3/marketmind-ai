from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.errors import ErrorBody


UUID = str
IsoDateTime = str
LanguageMode = Literal["ar-EG", "en", "mixed"]
AiDiscoveryAction = Literal[
    "ask_next_question",
    "ask_clarification",
    "produce_profile_draft",
    "safe_failure",
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
    created_at: IsoDateTime


class ProfileUncertainty(StrictModel):
    field_key: str
    description: str
    severity: Literal["low", "medium", "high"]


class BusinessProfileDraft(StrictModel):
    id: UUID
    session_id: UUID
    version: int
    status: Literal["draft", "ready_for_confirmation", "confirmed", "superseded"]
    confirmed_facts: dict[str, Any]
    research_observations: list[ResearchObservation]
    uncertainties: list[ProfileUncertainty]
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


class DiscoveryModelOutput(StrictModel):
    action: AiDiscoveryAction
    next_question: str | None = None
    updated_known_facts: dict[str, Any] = Field(default_factory=dict)
    updated_uncertainties: list[ProfileUncertainty] = Field(default_factory=list)
    owner_goals: list[str] = Field(default_factory=list)
    strategy_relevant_notes: list[str] = Field(default_factory=list)
    domain_scores: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_action_payload(self) -> "DiscoveryModelOutput":
        if self.action in {"ask_next_question", "ask_clarification"} and not self.next_question:
            raise ValueError("next_question is required for question actions")
        return self


class AiDiscoveryResult(StrictModel):
    action: AiDiscoveryAction
    next_question: str | None = None
    updated_known_facts: dict[str, Any]
    updated_uncertainties: list[ProfileUncertainty]
    research_observations: list[ResearchObservation]
    source_refs: list[SourceRef]
    domain_scores: dict[str, float]
    profile_draft: BusinessProfileDraft | None = None
    safe_error: ErrorBody | None = None
