"""Top-level unit tests for the shared platform-constraint advisory validator."""

from __future__ import annotations

import pytest

from platform_constraints import validate_platform_constraints


def test_no_warnings_for_compliant_instagram_post() -> None:
    item = {
        "channel": "instagram",
        "format": "static_image_post",
        "caption_variants": [
            {"locale": "ar", "caption": "short caption", "cta": None, "hashtags": []}
        ],
        "hashtags": [],
        "alt_text": "short alt",
    }
    assert validate_platform_constraints(item) == []


def test_overlong_instagram_caption_warns_on_caption_field() -> None:
    item = {
        "channel": "instagram",
        "format": "static_image_post",
        "caption_variants": [
            {"locale": "ar", "caption": "x" * 2500, "cta": None, "hashtags": []}
        ],
        "hashtags": [],
        "alt_text": "short alt",
    }
    warnings = validate_platform_constraints(item)
    assert len(warnings) == 1
    assert warnings[0].field == "caption"
    assert warnings[0].allowed == 2200
    assert warnings[0].actual == 2500


def test_overlimit_hashtags_warns_on_hashtags_field() -> None:
    item = {
        "channel": "tiktok",
        "format": "short_video_script",
        "caption_variants": [],
        "hashtags": ["#a", "#b", "#c", "#d", "#e", "#f"],
        "alt_text": None,
    }
    warnings = validate_platform_constraints(item)
    assert len(warnings) == 1
    assert warnings[0].field == "hashtags"
    assert warnings[0].allowed == 5


def test_overlong_alt_text_warns_on_alt_text_field() -> None:
    item = {
        "channel": "facebook",
        "format": "static_image_post",
        "caption_variants": [],
        "hashtags": [],
        "alt_text": "x" * 200,
    }
    warnings = validate_platform_constraints(item)
    assert len(warnings) == 1
    assert warnings[0].field == "alt_text"
    assert warnings[0].allowed == 100


def test_missing_channel_or_format_degrades_to_no_warnings() -> None:
    assert validate_platform_constraints({"channel": "instagram"}) == []
    assert validate_platform_constraints({"format": "static_image_post"}) == []
    assert validate_platform_constraints({}) == []


def test_unknown_channel_returns_no_warnings() -> None:
    item = {
        "channel": "snapchat",
        "format": "static_image_post",
        "caption_variants": [],
        "hashtags": [],
    }
    assert validate_platform_constraints(item) == []


def test_no_hashtags_allowed_on_gbp_warns_on_any_hashtag() -> None:
    item = {
        "channel": "google_business_profile",
        "format": "text_post",
        "caption_variants": [{"locale": "ar", "caption": "hi", "cta": None, "hashtags": []}],
        "hashtags": ["#local"],
    }
    warnings = validate_platform_constraints(item)
    assert len(warnings) == 1
    assert warnings[0].field == "hashtags"
    assert warnings[0].allowed == 0
