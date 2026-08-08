"""Deterministic Strategy v2 -> content-v1 projection.

Mirrors apps/api/src/modules/content/content-strategy.adapter.ts. The plan's
calendar weeks use the Strategy vocabulary; this module is the single
deterministic place that maps labels to the exact four content-v1 formats.

A usable handoff requires at least one owner-selected `content-v1` channel and
every calendar week to map to at least one known format. Otherwise the handoff
is explicitly unavailable with a machine-readable reason — never empty,
partial, or silently re-targeted.
"""

from __future__ import annotations

import re

from strategy_contracts import (
    ContentHandoff,
    ContentHandoffAvailable,
    ContentHandoffUnavailable,
    ContentHandoffWeek,
    LanguageMode,
)

CONTENT_FORMAT_VALUES = frozenset(
    ("static_image_post", "short_video_script", "carousel_brief", "text_post")
)

CONTENT_SUPPORTED_CHANNELS = frozenset(
    ("facebook", "instagram", "tiktok", "google_business_profile")
)

# Strategy label -> exact content-v1 format. Reviewed MVP mapping; exact
# content-v1 values pass through after normalization.
STRATEGY_LABEL_TO_CONTENT_FORMAT: dict[str, str] = {
    "static_image": "static_image_post",
    "photo": "static_image_post",
    "image": "static_image_post",
    "story": "static_image_post",
    "short_video": "short_video_script",
    "video": "short_video_script",
    "reel": "short_video_script",
    "reels": "short_video_script",
    "carousel": "carousel_brief",
    "text": "text_post",
    "post": "text_post",
    "caption": "text_post",
    "poll": "text_post",
    "quiz": "text_post",
    "question": "text_post",
}


def normalize_strategy_label(raw: str) -> str:
    """Trim, lowercase, and convert spaces/hyphens to underscores."""
    return re.sub(r"[\s-]+", "_", raw.strip().lower())


def map_strategy_label_to_content_format(raw: str) -> str | None:
    """Map one strategy format label to its exact content-v1 format."""
    normalized = normalize_strategy_label(raw)
    if normalized in CONTENT_FORMAT_VALUES:
        return normalized
    return STRATEGY_LABEL_TO_CONTENT_FORMAT.get(normalized)


def capability_state_for_choice(choice) -> str:
    """Visible capability state derived from the safe setup state.

    Real publishing requires a verified publishing target (#175). A connected
    channel without a verified target is publishing_pending; every other safe
    state is owner-managed.
    """
    setup_state = getattr(choice.setup_state, "value", choice.setup_state)
    if setup_state == "connected":
        if choice.publishing_target_id:
            return "publishing_ready"
        return "publishing_pending"
    return "owner_managed"


def project_content_handoff(
    *,
    calendar_weeks,
    selected_channels: list[str],
    language: str | LanguageMode,
) -> ContentHandoff:
    """Build the deterministic content-v1 projection from the v2 plan fields.

    Returns ContentHandoffUnavailable when no owner-selected channel maps to a
    content-v1 channel or when any calendar week fails to map to a known
    format. Never silently drops a channel or falls back to all formats.
    """
    content_channels = [
        channel
        for channel in selected_channels
        if channel in CONTENT_SUPPORTED_CHANNELS
    ]
    if not content_channels:
        return ContentHandoffUnavailable(
            available=False,
            reason="no_content_supported_channels",
            message=(
                "None of the owner-selected channels are supported by content-v1. "
                "The plan remains owner-managed; Content cycles cannot start."
            ),
        )

    language_value = getattr(language, "value", language)
    weeks: list[ContentHandoffWeek] = []
    for week in calendar_weeks:
        week_number = getattr(week, "week_number", week.get("week_number"))
        formats = getattr(week, "formats", None) or week.get("formats", [])
        mapped: list[str] = []
        for raw in formats:
            if not isinstance(raw, str):
                continue
            fmt = map_strategy_label_to_content_format(raw)
            if fmt is not None and fmt not in mapped:
                mapped.append(fmt)
        if not mapped:
            return ContentHandoffUnavailable(
                available=False,
                reason="incomplete_weekly_formats",
                message=(
                    f"Week {week_number} formats do not map to any known "
                    "content-v1 format. Content cycles cannot start."
                ),
            )
        weeks.append(ContentHandoffWeek(week_number=week_number, formats=mapped))

    return ContentHandoffAvailable(
        available=True,
        channels=content_channels,
        language=language_value,
        weeks=weeks,
    )
