"""Idempotent ingestion pipeline for the curated marketing knowledge corpus.
"""

from app.knowledge.ingestion.chunker import MarkdownChunker
from app.knowledge.ingestion.errors import IngestionError, IngestionErrorCode
from app.knowledge.ingestion.loader import (
    load_and_validate_corpus,
    load_marketing_knowledge_entries,
    ValidationIssue,
)
from app.knowledge.ingestion.normalizer import normalize_text
from app.knowledge.ingestion.schemas import (
    ParsedKnowledgeEntry,
    KnowledgeChunk,
    IngestionEntryResult,
    IngestionReport,
)
from app.knowledge.ingestion.source_resolution import resolve_source
from app.knowledge.ingestion.tokenizer import count_tokens

__all__ = [
    "IngestionError",
    "IngestionErrorCode",
    "load_and_validate_corpus",
    "load_marketing_knowledge_entries",
    "MarkdownChunker",
    "normalize_text",
    "ParsedKnowledgeEntry",
    "KnowledgeChunk",
    "IngestionEntryResult",
    "IngestionReport",
    "resolve_source",
    "count_tokens",
    "ValidationIssue",
]
