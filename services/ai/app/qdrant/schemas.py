from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ReviewStatus = Literal["approved", "draft", "retired", "expired"]
EvidenceTier = Literal["verified_benchmark", "reviewed_guidance", "contextual_note"]


class QdrantKnowledgePoint(BaseModel):
    """Payload stored in Qdrant for each knowledge chunk.

    Mirrors the curated RAG architecture: the vector lives in Qdrant, but all
    governance and approval metadata is authoritative in PostgreSQL.
    """

    model_config = ConfigDict(extra="forbid")

    chunk_id: UUID
    entry_id: UUID
    entry_version: int = Field(gt=0)
    checksum: str = Field(min_length=1)
    text: str = Field(min_length=1)

    kind: str
    locale: str
    markets: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    business_models: list[str] = Field(default_factory=list)

    objectives: list[str] = Field(default_factory=list)
    funnel_stages: list[str] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    seasons: list[str] = Field(default_factory=list)
    budget_modes: list[str] = Field(default_factory=list)

    evidence_tier: EvidenceTier
    review_status: ReviewStatus
    effective_at: datetime
    expires_at: datetime | None = None

    def to_payload(self) -> dict:
        """Serialize to a Qdrant-compatible payload dictionary."""
        payload = self.model_dump(mode="json")
        return payload

    @classmethod
    def from_payload(cls, payload: dict) -> "QdrantKnowledgePoint":
        return cls.model_validate(payload)
