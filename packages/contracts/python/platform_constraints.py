"""Shared per-platform content constraint vocabulary (Python mirror).

Warnings only, never blockers: these describe platform limits (caption length,
hashtag count, alt-text length) so a human reviewer can see the exact field that
is over the platform limit before approving.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from content_base import ContentChannel, ContentFormat


@dataclass(frozen=True)
class PlatformConstraint:
    channel: ContentChannel
    format: ContentFormat
    max_caption_length: int | None
    max_hashtags: int | None
    max_alt_text_length: int | None
    note: str


PLATFORM_CONSTRAINTS: list[PlatformConstraint] = [
    PlatformConstraint(
        channel="facebook",
        format="static_image_post",
        max_caption_length=63206,
        max_hashtags=30,
        max_alt_text_length=100,
        note="Facebook feed post; alt text is plain descriptive text.",
    ),
    PlatformConstraint(
        channel="instagram",
        format="static_image_post",
        max_caption_length=2200,
        max_hashtags=30,
        max_alt_text_length=100,
        note="Instagram feed post; link-in-bio only, no clickable URLs in caption.",
    ),
    PlatformConstraint(
        channel="facebook",
        format="short_video_script",
        max_caption_length=63206,
        max_hashtags=30,
        max_alt_text_length=None,
        note="Video post; caption limits mirror long-form post.",
    ),
    PlatformConstraint(
        channel="instagram",
        format="short_video_script",
        max_caption_length=2200,
        max_hashtags=30,
        max_alt_text_length=None,
        note="Reels/static story; link-in-bio applies.",
    ),
    PlatformConstraint(
        channel="facebook",
        format="text_post",
        max_caption_length=63206,
        max_hashtags=30,
        max_alt_text_length=None,
        note="Text-only post.",
    ),
    PlatformConstraint(
        channel="instagram",
        format="carousel_brief",
        max_caption_length=2200,
        max_hashtags=30,
        max_alt_text_length=None,
        note="Carousel; each card has its own cover alt text.",
    ),
]


@dataclass(frozen=True)
class PlatformConstraintWarning:
    constraint: PlatformConstraint
    field: str
    actual: int | None
    allowed: int | None
    message: str


def resolve_platform_constraint(
    channel: str,
    content_format: str,
) -> PlatformConstraint | None:
    for constraint in PLATFORM_CONSTRAINTS:
        if constraint.channel == channel and constraint.format == content_format:
            return constraint
    return None


def validate_platform_constraints(item: dict[str, Any]) -> list[PlatformConstraintWarning]:
    """Return advisory warnings for an item_version dict.

    ``item`` needs ``channel``, ``format``, ``caption_variants``, ``hashtags``,
    and ``alt_text``. Missing fields degrade to advisory-skip rather than error.
    """
    channel = item.get("channel")
    content_format = item.get("format")
    if not channel or not content_format:
        return []

    constraint = resolve_platform_constraint(channel, content_format)
    if constraint is None:
        return []

    warnings: list[PlatformConstraintWarning] = []

    def check(field: str, actual: int | None, allowed: int | None) -> None:
        if allowed is None or actual is None or actual <= allowed:
            return
        warnings.append(
            PlatformConstraintWarning(
                constraint=constraint,
                field=field,
                actual=actual,
                allowed=allowed,
                message=(
                    f"{channel}/{content_format} {field} is {actual}, "
                    f"over the {allowed} limit."
                ),
            )
        )

    caption_variants = item.get("caption_variants") or []
    caption_lengths = [
        len(variant.get("caption") or "")
        for variant in caption_variants
        if isinstance(variant, dict)
    ]
    check(
        "caption",
        max(caption_lengths, default=None),
        constraint.max_caption_length,
    )
    check(
        "hashtags",
        len(item.get("hashtags") or []),
        constraint.max_hashtags,
    )
    alt_text = item.get("alt_text")
    check("alt_text", len(alt_text) if isinstance(alt_text, str) else None, constraint.max_alt_text_length)

    return warnings
