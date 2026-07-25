class RetrievalError(Exception):
    """Base exception for the retrieval pipeline."""

    def __init__(self, message: str, detail: dict | None = None) -> None:
        self.message = message
        self.detail = detail or {}
        super().__init__(message)


class RetryableRetrievalError(RetrievalError):
    """Qdrant or DB transient failure — caller may retry."""


class NonRetryableRetrievalError(RetrievalError):
    """Invalid input or configuration — caller must not retry."""
