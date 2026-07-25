"""Async PostgreSQL access for the AI service.

The schema is owned by apps/api/prisma/schema.prisma; this module is only a
consumer so the AI service and the API share one source of truth.
"""

from app.db.client import get_db, close_db
from app.db.models import (
    Base,
    MarketingKnowledgeEntry,
    MarketingKnowledgeEntryVersion,
    MarketingKnowledgeSourceRef,
    MarketingKnowledgeChunk,
    MarketingKnowledgeIngestionRun,
    MarketingKnowledgeIngestionError,
)

__all__ = [
    "get_db",
    "close_db",
    "Base",
    "MarketingKnowledgeEntry",
    "MarketingKnowledgeEntryVersion",
    "MarketingKnowledgeSourceRef",
    "MarketingKnowledgeChunk",
    "MarketingKnowledgeIngestionRun",
    "MarketingKnowledgeIngestionError",
]
