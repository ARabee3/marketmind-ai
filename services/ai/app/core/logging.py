import json
import logging
import re
from collections.abc import Mapping
from typing import Any


_SENSITIVE_KEY_PARTS = (
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "token",
    "phone",
    "email",
    "whatsapp",
    "contact",
    "address",
)
_PRIVATE_CONTENT_KEYS = {
    "system_prompt",
    "user_prompt",
    "business_profile",
    "profile",
    "raw_provider_response",
    "raw_output",
    "item_versions",
    "previous_item_version_read_only",
    "revision_notes",
    "weekly_context",
    "strategy_week",
    "grounding_inputs",
}

_PHONE_PATTERN = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def _contains_pii(value: str) -> bool:
    return bool(_PHONE_PATTERN.search(value) or _EMAIL_PATTERN.search(value))


def _redact_log_value(value: Any, key: str) -> Any:
    normalized_key = key.lower().replace("-", "_")
    if normalized_key in _PRIVATE_CONTENT_KEYS or _is_sensitive_key(key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {
            str(child_key): _redact_log_value(child_value, str(child_key))
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [_redact_log_value(item, key) for item in value]
    if isinstance(value, str) and _contains_pii(value):
        return "[REDACTED]"
    return value


def redact_log_value(value: Any, key: str = "") -> Any:
    """Redact credentials, private content, and phone/email values recursively."""
    return _redact_log_value(value, key)


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
