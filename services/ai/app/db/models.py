"""SQLAlchemy models for the marketing knowledge governance tables.

These tables are owned by apps/api/prisma/schema.prisma and migrated by NestJS.
The AI service reads/writes them directly using the physical snake_case table and
column names as the stable contract. See apps/api/prisma/MARKETING_KNOWLEDGE_SCHEMA.md.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    ARRAY,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class MarketingKnowledgeEntry(Base):
    """Stable identity of a knowledge item, keyed by slug."""

    __tablename__ = "marketing_knowledge_entries"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    latest_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=datetime.utcnow
    )

    versions: Mapped[List["MarketingKnowledgeEntryVersion"]] = relationship(
        back_populates="entry", cascade="all, delete-orphan", lazy="selectin"
    )


class MarketingKnowledgeEntryVersion(Base):
    """Immutable, versioned knowledge content."""

    __tablename__ = "marketing_knowledge_entry_versions"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    entry_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("marketing_knowledge_entries.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(Text, nullable=False)
    markets: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    industries: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    business_models: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    objectives: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    funnel_stages: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    channels: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    seasons: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    budget_modes: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    evidence_tier: Mapped[str] = mapped_column(Text, nullable=False)
    review_status: Mapped[str] = mapped_column(Text, nullable=False, default="draft")
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    author: Mapped[str] = mapped_column(Text, nullable=False)
    reviewer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    checksum: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=datetime.utcnow
    )

    entry: Mapped["MarketingKnowledgeEntry"] = relationship(back_populates="versions")
    source_refs: Mapped[List["MarketingKnowledgeSourceRef"]] = relationship(
        back_populates="entry_version", cascade="all, delete-orphan", lazy="selectin"
    )
    chunks: Mapped[List["MarketingKnowledgeChunk"]] = relationship(
        back_populates="entry_version", cascade="all, delete-orphan", lazy="selectin"
    )


class MarketingKnowledgeSourceRef(Base):
    """Citation/source reference attached to one entry version."""

    __tablename__ = "marketing_knowledge_source_refs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    entry_version_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("marketing_knowledge_entry_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    reference: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=datetime.utcnow
    )

    entry_version: Mapped["MarketingKnowledgeEntryVersion"] = relationship(back_populates="source_refs")


class MarketingKnowledgeChunk(Base):
    """Deterministic chunk projection for an entry version."""

    __tablename__ = "marketing_knowledge_chunks"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    entry_version_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("marketing_knowledge_entry_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    chunk_order: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_provider: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_model: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding_version: Mapped[str] = mapped_column(Text, nullable=False)
    qdrant_point_id: Mapped[Optional[UUID]] = mapped_column(Uuid, nullable=True)
    qdrant_collection_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    indexed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=datetime.utcnow
    )

    entry_version: Mapped["MarketingKnowledgeEntryVersion"] = relationship(back_populates="chunks")


class MarketingKnowledgeIngestionRun(Base):
    """Record of one ingestion attempt."""

    __tablename__ = "marketing_knowledge_ingestion_runs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    commit_sha: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    configuration: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    entered_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=datetime.utcnow
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=datetime.utcnow
    )

    errors: Mapped[List["MarketingKnowledgeIngestionError"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )


class MarketingKnowledgeIngestionError(Base):
    """Per-entry failure recorded during an ingestion run."""

    __tablename__ = "marketing_knowledge_ingestion_errors"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("marketing_knowledge_ingestion_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    slug: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str] = mapped_column(Text, nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, default=datetime.utcnow
    )

    run: Mapped["MarketingKnowledgeIngestionRun"] = relationship(back_populates="errors")
