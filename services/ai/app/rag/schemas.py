from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RetrievalQueryContext(BaseModel):
    """Context for building privacy-minimized queries."""
    model_config = ConfigDict(extra="ignore")

    business_type: str
    market: str
    locale: str
    objective: str
    funnel_stage: str
    active_channels: list[str] = Field(default_factory=list)
    asset_capability: list[str] = Field(default_factory=list)
    team_capacity: str
    budget_mode: str
    industry: str | None = None
    free_text_notes: str | None = None


class RetrievalSubquery(BaseModel):
    """A focused semantic query for one specific aspect of the strategy."""
    category: str
    text: str
    kind_filter: str | list[str]
    locale_filter: list[str] | None = None
    market_filter: list[str] | None = None


class RetrievalCandidate(BaseModel):
    """A raw candidate returned from Qdrant search."""
    chunk_id: UUID
    entry_id: UUID
    entry_version: int
    score: float
    payload: dict[str, Any]
    subquery_category: str


class RegionalCandidate(BaseModel):
    """A candidate annotated with its regional fallback status."""
    candidate: RetrievalCandidate
    market_tier: Literal["egypt", "mena", "global"]
    is_fallback: bool
    fallback_label: str | None


class HydratedItem(BaseModel):
    """A selected chunk hydrated with canonical data from PostgreSQL."""
    chunk_id: UUID
    entry_id: UUID
    entry_version: int
    title: str
    excerpt: str
    kind: str
    tags: dict[str, list[str]]
    relevance_score: float
    evidence_tier: str
    source_references: list[str]
    effective_at: datetime
    expires_at: datetime | None
    review_status: str
    market_tier: str
    is_fallback: bool
    fallback_label: str | None
    category: str


class KnowledgeGap(BaseModel):
    """A missing critical piece of knowledge."""
    category: str
    description: str
    severity: Literal["blocking", "non_critical"]


class RetrievedKnowledgePack(BaseModel):
    """The final assembled pack, matching the TypeScript contract."""
    retrieval_run_id: UUID
    query_summary: str
    query_context: dict[str, Any]
    profile_version_id: UUID
    brief_id: UUID
    items: list[HydratedItem]
    knowledge_gaps: list[KnowledgeGap]
    retrieval_metadata: dict[str, Any]
    retrieved_at: datetime
