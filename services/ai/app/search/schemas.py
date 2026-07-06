from typing import Literal

from pydantic import Field

from app.discovery.schemas import LanguageMode, PreparedDiscoveryIntake, StrictModel

QueryPlanSource = Literal["llm", "deterministic"]
SearchQueryIntent = Literal[
    "business_match",
    "competitor_discovery",
    "market_context",
    "social_profile",
    "review_presence",
]
SearchProviderHint = Literal[
    "serpapi",
    "duckduckgo",
    "apify_google_maps",
    "metadata",
]
MetadataValue = str | int | float | bool
EvidenceClassification = Literal[
    "own_business",
    "competitor",
    "market_context",
    "social_signal",
    "directory",
    "irrelevant",
]
EvidenceTier = Literal["confirmed_signal", "needs_confirmation", "discarded"]


class QueryPlanningRequest(StrictModel):
    language_mode: LanguageMode = "mixed"
    intake: PreparedDiscoveryIntake


class PlannedSearchQuery(StrictModel):
    intent: SearchQueryIntent
    query: str
    language: LanguageMode
    priority: int = Field(ge=1, le=100)
    provider_hints: list[SearchProviderHint]
    metadata: dict[str, MetadataValue] = Field(default_factory=dict)


class QueryPlan(StrictModel):
    source: QueryPlanSource
    queries: list[PlannedSearchQuery] = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list)


class EvidenceTriageCandidate(StrictModel):
    index: int = Field(ge=0)
    intent: SearchQueryIntent
    provider: SearchProviderHint
    title: str | None = None
    url: str | None = None
    snippet: str | None = None
    query: str
    rank: int = Field(ge=1)
    provider_confidence: float = Field(ge=0, le=1)
    metadata: dict[str, MetadataValue] = Field(default_factory=dict)


class EvidenceTriageRequest(StrictModel):
    language_mode: LanguageMode = "mixed"
    intake: PreparedDiscoveryIntake
    candidates: list[EvidenceTriageCandidate] = Field(min_length=1, max_length=40)


class EvidenceTriageDecision(StrictModel):
    index: int = Field(ge=0)
    classification: EvidenceClassification
    evidence_tier: EvidenceTier
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1)
    candidate_facts: dict[str, str] = Field(default_factory=dict)
    suggested_owner_question: str | None = None


class EvidenceTriageResult(StrictModel):
    source: Literal["llm"]
    decisions: list[EvidenceTriageDecision] = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list)
