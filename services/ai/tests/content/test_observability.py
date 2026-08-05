"""Tests for non-secret Content event metadata and log redaction."""

from __future__ import annotations

import logging

from content_contracts import ContentValidationIssue, ContentValidationResult

from app.content.observability import content_event_metadata
from app.core.logging import log_content_event, redact_log_value


def test_redactor_removes_prompts_profiles_and_credentials() -> None:
    value = {
        "strategy_id": "fictional-strategy-id",
        "system_prompt": "private system prompt",
        "user_prompt": "private profile and owner context",
        "business_profile": {"business_name": "Fictional Corner"},
        "api_key": "fictional-secret",
        "nested": {"password": "fictional-password"},
    }

    redacted = redact_log_value(value)

    assert redacted["strategy_id"] == "fictional-strategy-id"
    assert redacted["system_prompt"] == "[REDACTED]"
    assert redacted["user_prompt"] == "[REDACTED]"
    assert redacted["business_profile"] == "[REDACTED]"
    assert redacted["api_key"] == "[REDACTED]"
    assert redacted["nested"]["password"] == "[REDACTED]"


def test_redactor_scrubs_phone_and_email_values_by_content() -> None:
    value = {
        "cta_destination": {"type": "whatsapp", "value": "+201000000000"},
        "owner_email": "owner@example.com",
        "caption": "Call +201012345678 or email sales@shop.example today.",
    }

    redacted = redact_log_value(value)

    assert redacted["cta_destination"]["value"] == "[REDACTED]"
    assert redacted["owner_email"] == "[REDACTED]"
    assert redacted["caption"] == "[REDACTED]"


def test_redactor_redacts_phone_and_email_keys_even_without_value_match() -> None:
    value = {"phone": "+201000000000", "email": "x@example.com"}

    redacted = redact_log_value(value)

    assert redacted["phone"] == "[REDACTED]"
    assert redacted["email"] == "[REDACTED]"


def test_redactor_removes_strategy_week_grounding_from_events() -> None:
    value = {
        "strategy_id": "fictional-strategy-id",
        "strategy_week": {"theme": "ramadan campaign", "pillars": []},
        "weekly_context": {"must_include": ["offer"]},
    }

    redacted = redact_log_value(value)

    assert redacted["strategy_id"] == "fictional-strategy-id"
    assert redacted["strategy_week"] == "[REDACTED]"
    assert redacted["weekly_context"] == "[REDACTED]"


def test_content_event_log_contains_safe_metadata_only(caplog) -> None:
    logger = logging.getLogger("tests.content.observability")
    metadata = {
        "content_pack_id": "fictional-pack-id",
        "input_snapshot_hash": "fictional-hash",
        "user_prompt": "private prompt",
        "OPENAI_API_KEY": "fictional-secret",
    }

    with caplog.at_level(logging.INFO, logger=logger.name):
        log_content_event(logger, "generation_started", metadata)

    message = caplog.records[-1].getMessage()
    assert "generation_started" in message
    assert "fictional-pack-id" in message
    assert "fictional-hash" in message
    assert "private prompt" not in message
    assert "fictional-secret" not in message
    assert "[REDACTED]" in message


def test_content_event_metadata_adds_validation_summary_without_raw_output() -> None:
    validation = ContentValidationResult(
        valid=False,
        issues=[
            ContentValidationIssue(
                code="CONTENT_SCHEMA_FAILURE",
                field="item_versions",
                message="fictional validation message",
                retryable=False,
            )
        ],
    )

    metadata = content_event_metadata(
        {"content_pack_id": "fictional-pack-id", "input_snapshot_hash": "hash"},
        attempt=2,
        item_count=3,
        validation=validation,
    )

    assert metadata["attempt"] == 2
    assert metadata["item_count"] == 3
    assert metadata["validation_valid"] is False
    assert metadata["validation_issue_codes"] == ["CONTENT_SCHEMA_FAILURE"]
    assert "fictional validation message" not in str(metadata)
