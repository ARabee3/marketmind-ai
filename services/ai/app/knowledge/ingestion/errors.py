"""Stable error codes and exceptions for the knowledge ingestion pipeline.
"""

from dataclasses import dataclass
from typing import Optional


class IngestionErrorCode:
    """Stable error codes used in ingestion reports and logs.

    These codes are persisted in `MarketingKnowledgeIngestionError.error_code`
    and must remain stable across releases.
    """

    # CLI authentication
    CLI_AUTH_MISSING = "CLI_AUTH_MISSING"
    CLI_AUTH_INVALID = "CLI_AUTH_INVALID"

    # Validation
    INVALID_METADATA = "INVALID_METADATA"
    CHECKSUM_MISMATCH = "CHECKSUM_MISMATCH"
    DUPLICATE_SLUG = "DUPLICATE_SLUG"
    TAXONOMY_VIOLATION = "TAXONOMY_VIOLATION"
    INVALID_DATE_RANGE = "INVALID_DATE_RANGE"
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
    INVALID_FRONT_MATTER = "INVALID_FRONT_MATTER"

    # Sources
    SOURCE_RESOLUTION_FAILED = "SOURCE_RESOLUTION_FAILED"
    SOURCE_RESOLUTION_TIMEOUT = "SOURCE_RESOLUTION_TIMEOUT"

    # Chunking
    CHUNK_TOO_LARGE = "CHUNK_TOO_LARGE"
    CHUNK_EMPTY = "CHUNK_EMPTY"
    CHUNK_RULE_BROKEN = "CHUNK_RULE_BROKEN"

    # Embeddings
    EMBEDDING_PROVIDER_ERROR = "EMBEDDING_PROVIDER_ERROR"
    EMBEDDING_DIMENSION_MISMATCH = "EMBEDDING_DIMENSION_MISMATCH"
    EMBEDDING_TIMEOUT = "EMBEDDING_TIMEOUT"

    # Persistence
    DB_WRITE_FAILED = "DB_WRITE_FAILED"
    DB_CONFLICT = "DB_CONFLICT"
    DB_ROLLBACK = "DB_ROLLBACK"

    # Qdrant
    QDRANT_UPSERT_FAILED = "QDRANT_UPSERT_FAILED"
    QDRANT_COLLECTION_ERROR = "QDRANT_COLLECTION_ERROR"
    QDRANT_POINT_ID_CONFLICT = "QDRANT_POINT_ID_CONFLICT"

    # Generic / unexpected
    UNEXPECTED_ERROR = "UNEXPECTED_ERROR"


@dataclass
class IngestionError(Exception):
    """Exception raised when an ingestion step fails.

    `retryable` indicates whether the same operation may succeed on retry.
    `slug` and `version` identify the offending entry when applicable.
    """

    code: str
    message: str
    retryable: bool = False
    slug: Optional[str] = None
    version: Optional[int] = None

    def __str__(self) -> str:
        ctx = ""
        if self.slug:
            ctx = f" [slug={self.slug}"
            if self.version is not None:
                ctx += f", version={self.version}"
            ctx += "]"
        return f"{self.code}: {self.message}{ctx}"
