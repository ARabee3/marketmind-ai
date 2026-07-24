"""Pydantic schemas for the ingestion pipeline.

These are internal Python shapes; the authoritative cross-service contracts
live in packages/contracts.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID


@dataclass
class ParsedKnowledgeEntry:
    """A knowledge entry parsed from Markdown front matter."""

    slug: str
    version: int
    kind: str
    title: str
    summary: str
    body: str
    body_checksum: str
    locale: str
    markets: list[str]
    industries: list[str]
    business_models: list[str]
    objectives: list[str]
    funnel_stages: list[str]
    channels: list[str]
    seasons: list[str]
    budget_modes: list[str]
    evidence_tier: str
    review_status: str
    source_references: list[str]
    effective_at: datetime
    expires_at: Optional[datetime]
    author: str
    reviewer: Optional[str]
    reviewed_at: Optional[datetime]
    file_path: str


@dataclass
class KnowledgeChunk:
    """A deterministic chunk projection before persistence."""

    chunk_order: int
    text: str
    token_count: int
    checksum: str
    # Stable chunk ID is derived from slug/version/order/checksum.
    chunk_id: UUID


@dataclass
class IngestionEntryResult:
    """Outcome for one entry in an ingestion run."""

    slug: str
    previous_version: Optional[int]
    new_version: Optional[int]
    status: str  # new, updated, skipped, retired, failed
    chunk_count: int = 0
    error_code: Optional[str] = None
    error_message: Optional[str] = None


@dataclass
class IngestionReport:
    """Final report for one ingestion run."""

    run_id: UUID
    status: str
    actor: str
    commit_sha: Optional[str]
    configuration: dict[str, Any]
    entered_count: int = 0
    updated_count: int = 0
    skipped_count: int = 0
    failed_count: int = 0
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    entries: list[IngestionEntryResult] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": str(self.run_id),
            "status": self.status,
            "actor": self.actor,
            "commit_sha": self.commit_sha,
            "configuration": self.configuration,
            "entered_count": self.entered_count,
            "updated_count": self.updated_count,
            "skipped_count": self.skipped_count,
            "failed_count": self.failed_count,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "entries": [
                {
                    "slug": e.slug,
                    "previous_version": e.previous_version,
                    "new_version": e.new_version,
                    "status": e.status,
                    "chunk_count": e.chunk_count,
                    "error_code": e.error_code,
                    "error_message": e.error_message,
                }
                for e in self.entries
            ],
            "errors": self.errors,
        }
