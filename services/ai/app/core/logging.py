import json
import logging
from collections.abc import Mapping
from typing import Any


_SENSITIVE_KEY_PARTS = (
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "token",
)
_PRIVATE_CONTENT_KEYS = {
    "system_prompt",
    "user_prompt",
    "business_profile",
    "profile",
    "raw_provider_response",
}


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def redact_log_value(value: Any, key: str = "") -> Any:
    """Redact credentials and private prompt/profile values recursively."""
    normalized_key = key.lower().replace("-", "_")
    if normalized_key in _PRIVATE_CONTENT_KEYS or any(
        part in normalized_key for part in _SENSITIVE_KEY_PARTS
    ):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {
            str(child_key): redact_log_value(child_value, str(child_key))
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [redact_log_value(item) for item in value]
    return value


def log_content_event(
    logger: logging.Logger,
    event: str,
    metadata: Mapping[str, Any],
) -> None:
    """Emit one JSON-encoded, redacted Content event without prompt bodies."""
    safe_metadata = redact_log_value(dict(metadata))
    logger.info(
        "content_event=%s metadata=%s",
        event,
        json.dumps(safe_metadata, ensure_ascii=False, sort_keys=True),
    )
