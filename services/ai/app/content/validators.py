"""Deterministic Content input and output validation."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import uuid
from collections.abc import Iterable
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from content_contracts import (
    AiContentGenerateRequest,
    ContentAsset,
    ContentErrorCode,
    ContentItemVersion,
    ContentValidationIssue,
    ContentValidationResult,
    validate_content_policy_fixture as validate_frozen_policy_fixture,
)


_BLOCKED_CLAIM_CODES: dict[str, ContentErrorCode] = {
    "price": "CONTENT_UNSUPPORTED_CLAIM",
    "availability": "CONTENT_UNSUPPORTED_CLAIM",
    "superiority": "CONTENT_UNSUPPORTED_CLAIM",
    "testimonial": "CONTENT_UNSUPPORTED_CLAIM",
    "guarantee": "CONTENT_POLICY_VIOLATION",
    "regulated": "CONTENT_POLICY_VIOLATION",
    "branded_sponsored": "CONTENT_POLICY_VIOLATION",
    "competitor_comparison": "CONTENT_UNSUPPORTED_CLAIM",
}

_ARABIC_RANGES: tuple[tuple[int, int], ...] = (
    (0x0600, 0x06FF),
    (0x0750, 0x077F),
    (0x0870, 0x089F),
    (0x08A0, 0x08FF),
    (0xFB50, 0xFDFF),
    (0xFE70, 0xFEFF),
)
_MIN_EXPECTED_SCRIPT_RATIO = 0.60
_CAIRO_TIMEZONE = ZoneInfo("Africa/Cairo")
_PATH_TOKEN_PATTERN = re.compile(r"([^.\[\]]+)|\[(\d+)\]")
_SOURCE_PATH_PATTERN = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*$"
)
_HASHTAG_PATTERN = re.compile(r"^#[^\s#]+$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_PROMOTION_PATTERN = re.compile(
    r"(?:\bdiscount\b|\boffer\b|\bfree\b|\bbuy one get one\b|خصم|عروض?|"
    r"مجان(?:ا|اً)|مجاني(?:ة)?|اشتر\S*\s+واحد|[0-9٠-٩]+\s*[%٪])",
    re.IGNORECASE,
)
_RISKY_CLAIM_PATTERNS: dict[str, tuple[re.Pattern[str], ContentErrorCode]] = {
    "price": (
        re.compile(r"(?:\b(?:price|cost|egp)\b|سعر|جنيه|[$€£]\s*[0-9٠-٩])", re.IGNORECASE),
        "CONTENT_UNSUPPORTED_CLAIM",
    ),
    "availability": (
        re.compile(
            r"(?:\b(?:available|in stock|sold out|opening hours?|open (?:daily|every day|from|until|at))\b|"
            r"متوفر|متاحة|نفد المخزون|مواعيد العمل|مفتوح(?:ة|ون)?\s+(?:يومي|كل يوم|من|حتى|الساعة))",
            re.IGNORECASE,
        ),
        "CONTENT_UNSUPPORTED_CLAIM",
    ),
    "superiority": (
        re.compile(r"(?:\b(?:best|number one|#1|better than)\b|الأفضل|رقم واحد|أفضل من)", re.IGNORECASE),
        "CONTENT_UNSUPPORTED_CLAIM",
    ),
    "testimonial": (
        re.compile(r"(?:\btestimonial\b|\bcustomer says\b|شهادة عميل|قال أحد عملائنا)", re.IGNORECASE),
        "CONTENT_UNSUPPORTED_CLAIM",
    ),
    "guarantee": (
        re.compile(r"(?:\b(?:guarantee|guaranteed|warranty)\b|نضمن|مضمون|ضمان)", re.IGNORECASE),
        "CONTENT_POLICY_VIOLATION",
    ),
    "regulated": (
        re.compile(
            r"(?:\b(?:cure|treats?|diagnos(?:e|is)|medical outcome|legal advice)\b|يشفي|يعالج|علاج مضمون|تشخيص|استشارة قانونية)",
            re.IGNORECASE,
        ),
        "CONTENT_POLICY_VIOLATION",
    ),
    "competitor_comparison": (
        re.compile(r"(?:\b(?:competitor|better than)\b|منافس|أفضل من)", re.IGNORECASE),
        "CONTENT_UNSUPPORTED_CLAIM",
    ),
    "branded_sponsored": (
        re.compile(r"(?:\b(?:sponsored|paid partnership)\b|إعلان ممول|شراكة مدفوعة)", re.IGNORECASE),
        "CONTENT_POLICY_VIOLATION",
    ),
}


def _issue(
    code: ContentErrorCode,
    field: str,
    message: str,
    *,
    retryable: bool = False,
) -> ContentValidationIssue:
    return ContentValidationIssue(
        code=code,
        field=field,
        message=message,
        retryable=retryable,
    )


def validate_content_generation_request(
    request: AiContentGenerateRequest,
) -> ContentValidationResult:
    """Validate the deterministic grounding boundary before provider calls.

    NestJS remains authoritative for cycle status, ownership, approval, and the
    weekly claim. This validator checks only the immutable snapshot supplied to
    FastAPI and mirrors the frozen TypeScript request policy.
    """
    issues: list[ContentValidationIssue] = []
    plan = request.strategy_plan
    profile = request.business_profile
    context = request.week_context

    if plan.strategy_id != request.strategy_id or plan.version != request.strategy_version:
        issues.append(
            _issue(
                "CONTENT_VERSION_CONFLICT",
                "strategy_plan.version",
                "Generation requires the exact approved Strategy identity and version.",
            )
        )

    if (
        profile.business_id != request.business_id
        or plan.profile_version.business_profile_version_id != profile.id
        or plan.profile_version.version != profile.version
    ):
        issues.append(
            _issue(
                "CONTENT_PROFILE_STALE",
                "business_profile.id",
                "Generation requires the confirmed Business Profile version referenced by Strategy.",
            )
        )

    plan_language = getattr(plan.plan_language, "value", plan.plan_language)
    if plan_language != request.language_mode:
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "language_mode",
                "Generation language must match the approved Strategy language.",
            )
        )

    approved_channels = {scorecard.channel for scorecard in plan.selected_channels}
    if not request.selected_channels or any(
        channel not in approved_channels for channel in request.selected_channels
    ):
        issues.append(
            _issue(
                "CONTENT_CHANNEL_MISMATCH",
                "selected_channels",
                "Generation channels must be selected by the approved Strategy.",
            )
        )
    elif len(set(request.selected_channels)) != len(request.selected_channels):
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "selected_channels",
                "Generation channels must not contain duplicates.",
            )
        )

    if not request.allowed_formats:
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "allowed_formats",
                "Generation requires at least one supported Content format.",
            )
        )
    elif len(set(request.allowed_formats)) != len(request.allowed_formats):
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "allowed_formats",
                "Generation formats must not contain duplicates.",
            )
        )

    target_item_count = derive_target_item_count(plan.content_strategy.weekly_cadence)
    if target_item_count is not None and not 3 <= target_item_count <= 5:
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "strategy_plan.content_strategy.weekly_cadence",
                "The approved weekly cadence must fit the 3-5 item Content-pack boundary.",
            )
        )

    if not 1 <= context.week_number <= 12:
        issues.append(
            _issue(
                "CONTENT_WEEK_OUT_OF_RANGE",
                "week_context.week_number",
                "Content week must be an integer from 1 through 12.",
            )
        )
    elif not any(
        week.week_number == context.week_number for week in plan.content_strategy.weeks
    ):
        issues.append(
            _issue(
                "CONTENT_WEEK_OUT_OF_RANGE",
                "week_context.week_number",
                "Generation week must exist in the approved Strategy roadmap.",
            )
        )

    if context.promotion_mode == "none" and context.promotion is not None:
        issues.append(
            _issue(
                "CONTENT_OFFER_UNAPPROVED",
                "week_context.promotion",
                "A no-promotion context cannot contain promotion details.",
            )
        )
    if context.promotion_mode == "owner_approved" and context.promotion is None:
        issues.append(
            _issue(
                "CONTENT_OFFER_UNAPPROVED",
                "week_context.promotion",
                "An owner-approved promotion context must include promotion details.",
            )
        )
    if context.context_source == "system_defaulted" and context.promotion is not None:
        issues.append(
            _issue(
                "CONTENT_POLICY_VIOLATION",
                "week_context.context_source",
                "System-defaulted context cannot contain an owner promotion.",
            )
        )

    for field, values in (
        ("week_context.must_include", context.must_include),
        ("week_context.must_avoid", context.must_avoid),
    ):
        normalized = [_normalize_text(value) for value in values]
        if any(not value for value in normalized) or len(normalized) != len(
            set(normalized)
        ):
            issues.append(
                _issue(
                    "CONTENT_SCHEMA_FAILURE",
                    field,
                    "Weekly owner instructions must be non-blank and unique.",
                )
            )

    normalized_includes = {
        _normalize_text(value) for value in context.must_include if value.strip()
    }
    normalized_avoids = {
        _normalize_text(value) for value in context.must_avoid if value.strip()
    }
    if normalized_includes.intersection(normalized_avoids):
        issues.append(
            _issue(
                "CONTENT_POLICY_VIOLATION",
                "week_context.must_include",
                "Weekly owner instructions cannot require and forbid the same text.",
            )
        )

    if len(context.approved_asset_ids) != len(set(context.approved_asset_ids)):
        issues.append(
            _issue(
                "CONTENT_SCHEMA_FAILURE",
                "week_context.approved_asset_ids",
                "Approved owner asset identities must not contain duplicates.",
            )
        )

    destination = context.cta_destination
    destination_type = (
        destination.get("type") if isinstance(destination, dict) else destination.type
    )
    destination_value = (
        destination.get("value") if isinstance(destination, dict) else destination.value
    )
    if (destination_type == "none") != (destination_value is None):
        issues.append(
            _issue(
                "CONTENT_POLICY_VIOLATION",
                "week_context.cta_destination",
                "CTA destination value must be null only when destination type is none.",
            )
        )
    elif destination_type != "none" and not destination_value.strip():
        issues.append(
            _issue(
                "CONTENT_POLICY_VIOLATION",
                "week_context.cta_destination.value",
                "A confirmed CTA destination must contain a non-blank value.",
            )
        )

    timestamp_fields = [
        ("week_context.generation_cutoff_at", context.generation_cutoff_at),
    ]
    if context.confirmed_at is not None:
        timestamp_fields.append(("week_context.confirmed_at", context.confirmed_at))
    if context.system_defaulted_at is not None:
        timestamp_fields.append(
            ("week_context.system_defaulted_at", context.system_defaulted_at)
        )
    if context.promotion is not None:
        promotion = context.promotion
        promotion_text = (
            promotion.get("text", "")
            if isinstance(promotion, dict)
            else promotion.text
        )
        promotion_terms = (
            promotion.get("terms", [])
            if isinstance(promotion, dict)
            else promotion.terms
        )
        if not promotion_text.strip() or any(
            not term.strip() for term in promotion_terms
        ):
            issues.append(
                _issue(
                    "CONTENT_OFFER_UNAPPROVED",
                    "week_context.promotion",
                    "Owner-approved promotion text and terms must be non-blank.",
                )
            )
        normalized_terms = [_normalize_text(term) for term in promotion_terms]
        if len(normalized_terms) != len(set(normalized_terms)):
            issues.append(
                _issue(
                    "CONTENT_OFFER_UNAPPROVED",
                    "week_context.promotion.terms",
                    "Owner-approved promotion terms must not contain duplicates.",
                )
            )
        promotion_valid_from = (
            promotion.get("valid_from")
            if isinstance(promotion, dict)
            else promotion.valid_from
        )
        promotion_valid_until = (
            promotion.get("valid_until")
            if isinstance(promotion, dict)
            else promotion.valid_until
        )
        if promotion_valid_from is not None:
            timestamp_fields.append(
                ("week_context.promotion.valid_from", promotion_valid_from)
            )
        if promotion_valid_until is not None:
            timestamp_fields.append(
                ("week_context.promotion.valid_until", promotion_valid_until)
            )
    for field, value in timestamp_fields:
        if not _is_timezone_aware(value):
            issues.append(
                _issue(
                    "CONTENT_SCHEMA_FAILURE",
                    field,
                    "Content timestamps must include an explicit timezone offset.",
                )
            )

    return ContentValidationResult(valid=not issues, issues=issues)


# Keep the shorter name available for service code and tests.
validate_generation_request = validate_content_generation_request


def derive_strategy_pillar_ids(strategy_id: str, count: int) -> list[str]:
    """Derive stable trace IDs because Strategy v1 stores pillars without IDs."""
    return [
        str(uuid.uuid5(uuid.NAMESPACE_URL, f"{strategy_id}:content-pillar:{index + 1}"))
        for index in range(max(1, count))
    ]


def derive_target_item_count(weekly_cadence: str) -> int | None:
    """Extract an explicit 3-5 item cadence without mistaking clock times."""
    normalized_digits = "".join(
        str(unicodedata.digit(character)) if character.isdigit() else character
        for character in weekly_cadence
    )
    count_patterns = (
        r"([0-9]+)\s*(?:posts?|pieces?|items?|منشور(?:ات)?|قطع(?:ة)?)",
        r"(?:posts?|pieces?|items?|منشور(?:ات)?|قطع(?:ة)?)\s*[:=-]?\s*([0-9]+)",
    )
    for pattern in count_patterns:
        match = re.search(pattern, normalized_digits, flags=re.IGNORECASE)
        if match:
            return int(match.group(1))
    for value in re.findall(r"(?<![0-9])([3-5])(?![0-9])", normalized_digits):
        return int(value)
    return None


_CONTENT_TIMESTAMP_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"
    r"(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$"
)


def _normalize_content_timestamp(value: str) -> str:
    """Match Nest's Date#toISOString precision and UTC representation."""
    if _CONTENT_TIMESTAMP_PATTERN.fullmatch(value) is None:
        return value
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return value
        utc = parsed.astimezone(timezone.utc)
        # Prisma/Nest round-trips through JavaScript Date, which exposes
        # millisecond precision. Truncate, rather than round, like JS Date.
        utc = utc.replace(microsecond=(utc.microsecond // 1000) * 1000)
        return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except ValueError:
        return value


def _normalize_content_checksum_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return _normalize_content_timestamp(value.isoformat())
    if isinstance(value, str):
        return _normalize_content_timestamp(value)
    if isinstance(value, list):
        return [_normalize_content_checksum_value(child) for child in value]
    if isinstance(value, dict):
        return {
            key: _normalize_content_checksum_value(child)
            for key, child in value.items()
        }
    return value


def canonical_content_item_version_json(
    item: ContentItemVersion | dict[str, Any],
) -> str:
    """Serialize an item version using the shared content-v1 checksum rules."""
    if isinstance(item, ContentItemVersion):
        payload = item.model_dump(mode="json")
    else:
        payload = dict(item)
    payload.pop("version_checksum", None)
    canonical = json.dumps(
        _normalize_content_checksum_value(payload),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return canonical


def compute_content_item_checksum(item: ContentItemVersion | dict[str, Any]) -> str:
    """Hash canonical JSON after excluding only the checksum field itself."""
    return hashlib.sha256(
        canonical_content_item_version_json(item).encode("utf-8")
    ).hexdigest()


def _add_output_issue(
    issues: list[ContentValidationIssue],
    code: ContentErrorCode,
    field: str,
    message: str,
    *,
    retryable: bool = False,
) -> None:
    issues.append(_issue(code, field, message, retryable=retryable))


def _item_text(item: ContentItemVersion) -> str:
    return json.dumps(item.model_dump(mode="json"), ensure_ascii=False)


def _is_arabic_letter(character: str) -> bool:
    return unicodedata.category(character).startswith("L") and any(
        start <= ord(character) <= end for start, end in _ARABIC_RANGES
    )


def _is_latin_letter(character: str) -> bool:
    return (
        unicodedata.category(character).startswith("L")
        and "LATIN" in unicodedata.name(character, "")
    )


def _matches_expected_script(
    text: str,
    language_mode: str,
    protected_texts: Iterable[str] = (),
) -> bool:
    for protected_text in protected_texts:
        if protected_text:
            text = text.replace(protected_text, " ")
    arabic_letters = sum(1 for character in text if _is_arabic_letter(character))
    latin_letters = sum(1 for character in text if _is_latin_letter(character))
    total = arabic_letters + latin_letters
    if total == 0:
        return False
    expected = arabic_letters if language_mode == "ar-EG" else latin_letters
    return expected / total >= _MIN_EXPECTED_SCRIPT_RATIO


def _owner_facing_item_texts(item: ContentItemVersion) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    for index, variant in enumerate(item.caption_variants):
        entries.append((f"caption_variants[{index}].caption", variant.caption))
        if variant.cta:
            entries.append((f"caption_variants[{index}].cta", variant.cta))
    if item.cta:
        entries.append(("cta", item.cta))
    entries.extend(
        (
            ("creative_brief", item.creative_brief),
            ("alt_text", item.alt_text),
        )
    )
    if item.short_video_script:
        script = item.short_video_script
        entries.append(("short_video_script.hook", script.hook))
        if script.closing_cta:
            entries.append(("short_video_script.closing_cta", script.closing_cta))
        for index, scene in enumerate(script.scenes):
            entries.append(
                (f"short_video_script.scenes[{index}].visual_direction", scene.visual_direction)
            )
            if scene.voiceover:
                entries.append(
                    (f"short_video_script.scenes[{index}].voiceover", scene.voiceover)
                )
            if scene.on_screen_text:
                entries.append(
                    (f"short_video_script.scenes[{index}].on_screen_text", scene.on_screen_text)
                )
    return entries


def _validate_item_language(
    item: ContentItemVersion,
    language_mode: str,
    protected_texts: Iterable[str] = (),
) -> list[ContentValidationIssue]:
    if language_mode == "mixed":
        return []
    issues: list[ContentValidationIssue] = []
    for field, text in _owner_facing_item_texts(item):
        if text.strip() and not _matches_expected_script(
            text, language_mode, protected_texts
        ):
            language_name = "Arabic" if language_mode == "ar-EG" else "English"
            _add_output_issue(
                issues,
                "CONTENT_SCHEMA_FAILURE",
                f"item.{field}",
                f"Owner-facing Content must be predominantly {language_name} for language_mode={language_mode}.",
            )
    return issues


def _profile_protected_texts(value: Any, key_path: str = "") -> list[str]:
    """Collect protected identity/contact text for explicit mutation checks."""
    if isinstance(value, dict):
        values: list[str] = []
        for key, child in value.items():
            child_path = f"{key_path}.{key}" if key_path else key
            values.extend(_profile_protected_texts(child, child_path))
        return values
    if isinstance(value, list):
        values = []
        for index, child in enumerate(value):
            values.extend(_profile_protected_texts(child, f"{key_path}[{index}]"))
        return values
    protected_keys = (
        "business_name",
        "handle",
        "address",
        "phone",
        "whatsapp",
        "url",
        "website",
    )
    if isinstance(value, str) and any(
        key in key_path.lower() for key in protected_keys
    ):
        return [value] if value.strip() else []
    return []


def _normalize_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).casefold().split())


_OWNER_INSTRUCTION_WORDS = {
    "a",
    "an",
    "and",
    "any",
    "avoid",
    "do",
    "don't",
    "include",
    "make",
    "mention",
    "not",
    "please",
    "sure",
    "the",
    "to",
    "use",
    "using",
    "أن",
    "أي",
    "اذكر",
    "أذكر",
    "استخدام",
    "استخدم",
    "تجنب",
    "تذكر",
    "تستخدم",
    "ذكر",
    "ضمّن",
    "ضمن",
    "فضلك",
    "لا",
    "من",
}


def _instruction_terms(instruction: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[^\W_]+", _normalize_text(instruction))
        if token not in _OWNER_INSTRUCTION_WORDS
    ]


def _must_include_is_satisfied(instruction: str, owner_text: str) -> bool:
    terms = _instruction_terms(instruction)
    if not terms:
        return _normalize_text(instruction) in _normalize_text(owner_text)
    owner_terms = set(re.findall(r"[^\W_]+", _normalize_text(owner_text)))
    return all(term in owner_terms for term in terms)


def _must_avoid_is_present(instruction: str, owner_text: str) -> bool:
    terms = _instruction_terms(instruction)
    if not terms:
        return _normalize_text(instruction) in _normalize_text(owner_text)
    owner_terms = set(re.findall(r"[^\W_]+", _normalize_text(owner_text)))
    return all(term in owner_terms for term in terms)


def _is_timezone_aware(value: Any) -> bool:
    return (
        isinstance(value, datetime)
        and value.tzinfo is not None
        and value.utcoffset() is not None
    )


def _item_owner_text_blob(item: ContentItemVersion) -> str:
    return "\n".join(text for _, text in _owner_facing_item_texts(item))


def _item_semantic_fingerprint(item: ContentItemVersion) -> str:
    payload = {
        "channel": item.channel,
        "format": item.format,
        "caption_variants": [
            variant.model_dump(mode="json") for variant in item.caption_variants
        ],
        "cta": item.cta,
        "hashtags": item.hashtags,
        "creative_brief": item.creative_brief,
        "alt_text": item.alt_text,
        "short_video_script": (
            item.short_video_script.model_dump(mode="json")
            if item.short_video_script is not None
            else None
        ),
    }
    return hashlib.sha256(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _resolve_claim_source(
    request: AiContentGenerateRequest,
    claim: Any,
) -> tuple[bool, Any]:
    root_names = {
        "profile": "business_profile",
        "strategy": "strategy_plan",
        "week_context": "week_context",
    }
    root_name = root_names.get(claim.source_type)
    if root_name is None or _SOURCE_PATH_PATTERN.fullmatch(claim.source_path) is None:
        return False, None
    roots = {
        "business_profile": request.business_profile.model_dump(mode="json"),
        "strategy_plan": request.strategy_plan.model_dump(mode="json"),
        "week_context": request.week_context.model_dump(mode="json"),
    }
    path_tokens: list[str | int] = []
    for name, index in _PATH_TOKEN_PATTERN.findall(claim.source_path):
        path_tokens.append(int(index) if index else name)
    if not path_tokens or path_tokens[0] != root_name:
        return False, None

    value: Any = roots[root_name]
    for token in path_tokens[1:]:
        if isinstance(token, int):
            if not isinstance(value, list) or token >= len(value):
                return False, None
            value = value[token]
        else:
            if not isinstance(value, dict) or token not in value:
                return False, None
            value = value[token]
    return True, value


def _claim_source_is_eligible(
    request: AiContentGenerateRequest,
    claim: Any,
    *,
    required_pattern: re.Pattern[str] | None = None,
    claim_text: str | None = None,
) -> bool:
    if not claim.approved:
        return False
    resolved, source_value = _resolve_claim_source(request, claim)
    if not resolved:
        return False
    if claim.claim_type == "promotion" and (
        claim.source_type != "week_context"
        or not claim.source_path.startswith("week_context.promotion")
        or request.week_context.promotion_mode != "owner_approved"
        or request.week_context.promotion is None
    ):
        return False
    if required_pattern is None:
        return True
    if claim_text is None:
        return False
    normalized_claim_text = _normalize_text(claim_text)
    for leaf_path, leaf_value in _grounding_leaf_values(
        source_value,
        claim.source_path,
    ):
        searchable_source = f"{leaf_path.replace('_', ' ')} {leaf_value}"
        if required_pattern.search(searchable_source) is None:
            continue
        normalized_value = _normalize_text(str(leaf_value))
        if normalized_value and re.search(
            rf"(?<!\w){re.escape(normalized_value)}(?!\w)",
            normalized_claim_text,
        ):
            return True
    return False


def _grounding_leaf_values(
    value: Any,
    path: str,
) -> list[tuple[str, str | int | float]]:
    if isinstance(value, dict):
        leaves: list[tuple[str, str | int | float]] = []
        for key, child in value.items():
            leaves.extend(_grounding_leaf_values(child, f"{path}.{key}"))
        return leaves
    if isinstance(value, list):
        leaves = []
        for index, child in enumerate(value):
            leaves.extend(_grounding_leaf_values(child, f"{path}[{index}]"))
        return leaves
    if isinstance(value, bool) or value is None:
        return []
    if isinstance(value, (str, int, float)) and str(value).strip():
        return [(path, value)]
    return []


def _validate_hashtags(
    hashtags: Iterable[str],
    field: str,
    channel: str,
) -> list[ContentValidationIssue]:
    values = list(hashtags)
    issues: list[ContentValidationIssue] = []
    if channel == "google_business_profile":
        if values:
            _add_output_issue(
                issues,
                "CONTENT_SCHEMA_FAILURE",
                field,
                "Google Business Profile posts do not use hashtags.",
            )
    elif not values:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            field,
            "Generated Content requires at least one channel-appropriate hashtag.",
        )
    if len(values) != len(set(values)):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            field,
            "Hashtags must not contain duplicates.",
        )
    if any(not _HASHTAG_PATTERN.fullmatch(value) for value in values):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            field,
            "Every hashtag must start with # and contain no whitespace.",
        )
    return issues


def _validate_asset_record(asset: ContentAsset) -> list[ContentValidationIssue]:
    issues: list[ContentValidationIssue] = []
    field = f"assets[{asset.id}]"
    for identity_field, value in (
        (f"{field}.id", asset.id),
        (f"{field}.content_item_version_id", asset.content_item_version_id),
    ):
        try:
            uuid.UUID(str(value))
        except (ValueError, AttributeError, TypeError):
            _add_output_issue(
                issues,
                "CONTENT_SCHEMA_FAILURE",
                identity_field,
                "Content asset identities must be valid UUIDs.",
            )
    if asset.status == "ready":
        if (
            asset.kind == "prompt_only"
            or not asset.mime_type
            or not asset.mime_type.startswith("image/")
            or not asset.storage_key
            or not asset.checksum
            or _SHA256_PATTERN.fullmatch(asset.checksum) is None
            or asset.width is None
            or asset.width <= 0
            or asset.height is None
            or asset.height <= 0
            or not asset.alt_text.strip()
            or asset.failure_code is not None
        ):
            _add_output_issue(
                issues,
                "CONTENT_ASSET_REQUIRED",
                field,
                "Ready Content assets require publishable immutable media metadata.",
            )
        if asset.kind == "generated_static" and not all(
            (asset.provider_name, asset.provider_model, asset.provider_request_id)
        ):
            _add_output_issue(
                issues,
                "CONTENT_PROVIDER_FAILURE",
                field,
                "Ready generated assets require complete provider provenance.",
            )
        if asset.kind == "owner_supplied" and any(
            (asset.provider_name, asset.provider_model, asset.provider_request_id)
        ):
            _add_output_issue(
                issues,
                "CONTENT_POLICY_VIOLATION",
                field,
                "Owner-supplied assets cannot claim generated provider provenance.",
            )
    elif asset.storage_key is not None or asset.checksum is not None:
        _add_output_issue(
            issues,
            "CONTENT_POLICY_VIOLATION",
            field,
            "Non-ready Content assets cannot expose authoritative media references.",
        )
    return issues


def _validate_risky_claim_text(
    request: AiContentGenerateRequest,
    item: ContentItemVersion,
) -> list[ContentValidationIssue]:
    issues: list[ContentValidationIssue] = []
    owner_text = _item_owner_text_blob(item)

    promotion_detected = _PROMOTION_PATTERN.search(owner_text) is not None
    promotion_claims = [
        claim for claim in item.claim_sources if claim.claim_type == "promotion"
    ]
    if promotion_detected or promotion_claims:
        promotion = request.week_context.promotion
        eligible_promotion = any(
            _claim_source_is_eligible(request, claim) for claim in promotion_claims
        )
        if promotion is None or not eligible_promotion:
            _add_output_issue(
                issues,
                "CONTENT_OFFER_UNAPPROVED",
                "item.claim_sources",
                "Promotional copy requires the exact owner-approved weekly promotion source.",
            )
        else:
            required_terms = [promotion.text, *promotion.terms]
            if any(term not in owner_text for term in required_terms):
                _add_output_issue(
                    issues,
                    "CONTENT_OFFER_UNAPPROVED",
                    "item.caption_variants",
                    "Owner-approved promotion text and terms must be preserved exactly.",
                )

    for claim_type, (pattern, code) in _RISKY_CLAIM_PATTERNS.items():
        if pattern.search(owner_text) is None:
            continue
        matching_claims = [
            claim for claim in item.claim_sources if claim.claim_type == claim_type
        ]
        if not any(
            _claim_source_is_eligible(
                request,
                claim,
                required_pattern=pattern,
                claim_text=owner_text,
            )
            for claim in matching_claims
        ):
            _add_output_issue(
                issues,
                code,
                "item.claim_sources",
                "A material risky claim has no matching approved grounding source.",
            )
    return issues


def _validate_item_against_generation_request(
    request: AiContentGenerateRequest,
    item: ContentItemVersion,
    assets_by_id: dict[str, ContentAsset],
    *,
    protected_text_mutated: bool,
    enforce_asset_readiness: bool,
    expected_version: int | None = 1,
) -> list[ContentValidationIssue]:
    issues: list[ContentValidationIssue] = []
    strategy_week = request.week_context.week_number
    approved_channels = set(request.selected_channels)
    expected_pillars = set(
        derive_strategy_pillar_ids(
            request.strategy_id,
            len(request.strategy_plan.content_strategy.pillars),
        )
    )
    expected_objective = str(
        getattr(
            request.strategy_plan.primary_objective,
            "value",
            request.strategy_plan.primary_objective,
        )
    )

    for field, value in (
        ("item.id", item.id),
        ("item.content_item_id", item.content_item_id),
        ("item.content_pack_id", item.content_pack_id),
        ("item.generation_provenance.generation_run_id", item.generation_provenance.generation_run_id),
    ):
        try:
            uuid.UUID(str(value))
        except (ValueError, AttributeError, TypeError):
            _add_output_issue(
                issues,
                "CONTENT_SCHEMA_FAILURE",
                field,
                "Content identities must be valid UUIDs.",
            )

    if expected_version is not None and item.version != expected_version:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.version",
            f"Generation must create item version {expected_version}.",
        )

    if item.content_pack_id != request.content_pack_id:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.content_pack_id",
            "Every generated item must belong to the requested Content pack.",
        )
    if item.channel not in approved_channels:
        _add_output_issue(
            issues,
            "CONTENT_CHANNEL_MISMATCH",
            "item.channel",
            "Generated item channel must be selected by the approved Strategy.",
        )
    if item.format not in request.allowed_formats:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.format",
            "Generated item format must be in the requested supported formats.",
        )
    if item.language_mode != request.language_mode:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.language_mode",
            "Generated item language must match the approved Strategy language.",
        )
    trace = item.strategy_trace
    if (
        trace.strategy_id != request.strategy_id
        or trace.strategy_version != request.strategy_version
        or trace.week_number != strategy_week
    ):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.strategy_trace",
            "Every item must trace to the exact requested Strategy version and week.",
        )
    if trace.channel != item.channel:
        _add_output_issue(
            issues,
            "CONTENT_CHANNEL_MISMATCH",
            "item.strategy_trace.channel",
            "Item channel must match its Strategy trace channel.",
        )
    trace_pillars = set(trace.pillar_ids)
    if not trace_pillars or not trace_pillars.issubset(expected_pillars):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.strategy_trace.pillar_ids",
            "Every item must trace only to one or more supplied Strategy pillars.",
        )
    if trace.objective != expected_objective:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.strategy_trace.objective",
            "Every item must preserve the exact approved Strategy objective.",
        )

    expected_locale = "en" if request.language_mode == "en" else "ar"
    locale_values = [variant.locale for variant in item.caption_variants]
    locales = set(locale_values)
    if len(locales) != len(locale_values):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.caption_variants",
            "Caption locales must not contain duplicates.",
        )
    if expected_locale not in locales:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.caption_variants",
            "Caption variants must include the approved owner-facing language.",
        )
    if request.language_mode == "mixed" and not {"ar", "en"}.issubset(locales):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.caption_variants",
            "Mixed-language Content requires Arabic and English caption variants.",
        )
    protected_language_texts: list[str] = []
    profile_promotion = request.week_context.promotion
    if profile_promotion is not None:
        protected_language_texts.extend(
            [profile_promotion.text, *profile_promotion.terms]
        )
    protected_language_texts.extend(request.week_context.must_include)
    protected_language_texts.extend(
        _profile_protected_texts(request.business_profile.profile)
    )
    issues.extend(
        _validate_item_language(
            item,
            request.language_mode,
            protected_language_texts,
        )
    )

    if item.format == "short_video_script" and item.short_video_script is None:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.short_video_script",
            "Short-video formats require a structured short-video script.",
        )
    if item.format != "short_video_script" and item.short_video_script is not None:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.short_video_script",
            "Only short-video formats may contain a short-video script.",
        )
    if item.short_video_script is not None:
        scene_orders = [scene.order for scene in item.short_video_script.scenes]
        if not scene_orders or scene_orders != list(range(1, len(scene_orders) + 1)):
            _add_output_issue(
                issues,
                "CONTENT_SCHEMA_FAILURE",
                "item.short_video_script.scenes",
                "Short-video scene order must be contiguous and start at 1.",
            )

    media_formats = {"static_image_post", "carousel_brief"}
    if item.format in media_formats and not item.asset_required:
        _add_output_issue(
            issues,
            "CONTENT_ASSET_REQUIRED",
            "item.asset_required",
            "Static-image and carousel drafts must declare their media requirement.",
        )
    if item.format not in media_formats and item.asset_required:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.asset_required",
            "This Content format must not claim a generated static-media requirement.",
        )

    if not item.creative_brief.strip() or not item.alt_text.strip():
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.creative_brief",
            "Generated items require a creative brief and alt text.",
        )
    if not item.claim_sources:
        _add_output_issue(
            issues,
            "CONTENT_POLICY_VIOLATION",
            "item.claim_sources",
            "Every generated item requires material claim provenance.",
        )

    issues.extend(_validate_hashtags(item.hashtags, "item.hashtags", item.channel))
    for index, variant in enumerate(item.caption_variants):
        issues.extend(
            _validate_hashtags(
                variant.hashtags,
                f"item.caption_variants[{index}].hashtags",
                item.channel,
            )
        )
    if item.caption_variants and item.hashtags != item.caption_variants[0].hashtags:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.hashtags",
            "Top-level hashtags must match the primary caption variant.",
        )
    if item.caption_variants and item.cta != item.caption_variants[0].cta:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.cta",
            "Top-level CTA must match the primary caption variant CTA.",
        )

    destination = request.week_context.cta_destination
    destination_type = (
        destination.get("type")
        if isinstance(destination, dict)
        else destination.type
    )
    destination_value = (
        destination.get("value")
        if isinstance(destination, dict)
        else destination.value
    )
    all_ctas = [item.cta, *(variant.cta for variant in item.caption_variants)]
    if destination_type == "none":
        if any(cta is not None for cta in all_ctas):
            _add_output_issue(
                issues,
                "CONTENT_POLICY_VIOLATION",
                "item.cta",
                "A no-destination weekly context cannot emit a CTA destination.",
            )
    elif destination_value is None or not destination_value.strip():
        _add_output_issue(
            issues,
            "CONTENT_POLICY_VIOLATION",
            "week_context.cta_destination.value",
            "The confirmed CTA destination requires a non-empty value.",
        )
    elif not any(
        cta is not None and destination_value in cta
        for cta in all_ctas
    ):
        _add_output_issue(
            issues,
            "CONTENT_POLICY_VIOLATION",
            "item.cta",
            "Generated CTA copy must preserve the confirmed destination value.",
        )

    publish_window = item.recommended_publish_window
    if (
        not _is_timezone_aware(publish_window.starts_at)
        or not _is_timezone_aware(publish_window.ends_at)
    ):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.recommended_publish_window",
            "Recommended publish times must be timezone-aware.",
        )
    elif publish_window.ends_at <= publish_window.starts_at:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.recommended_publish_window",
            "Recommended publish window must end after it starts.",
        )
    else:
        local_start = publish_window.starts_at.astimezone(_CAIRO_TIMEZONE)
        local_end = publish_window.ends_at.astimezone(_CAIRO_TIMEZONE)
        week_start = request.week_context.week_start_date
        week_start_at = datetime.combine(
            week_start,
            time.min,
            tzinfo=_CAIRO_TIMEZONE,
        )
        week_end_at = week_start_at + timedelta(days=7)
        if not week_start_at <= local_start < local_end <= week_end_at:
            _add_output_issue(
                issues,
                "CONTENT_VERSION_CONFLICT",
                "item.recommended_publish_window.starts_at",
                "Recommended publish window must remain inside the requested Strategy week.",
            )

    item_text = _item_text(item)
    profile_texts = _profile_protected_texts(request.business_profile.profile)
    if protected_text_mutated:
        _add_output_issue(
            issues,
            "CONTENT_POLICY_VIOLATION",
            "item.protected_text",
            "Protected owner and business text was mutated by generation.",
        )
    # Protected values may be omitted when irrelevant; if emitted, they must be
    # present byte-for-byte rather than silently translated or rewritten.
    for protected_text in profile_texts:
        if protected_text in item_text:
            continue
        if any(
            token in item_text
            for token in protected_text.split()
            if len(token) >= 4
        ):
            _add_output_issue(
                issues,
                "CONTENT_POLICY_VIOLATION",
                "item.protected_text",
                "A protected owner or business value appears to have been rewritten.",
            )
            break

    claim_identities = [
        (claim.claim_type, claim.source_type, claim.source_path)
        for claim in item.claim_sources
    ]
    if len(claim_identities) != len(set(claim_identities)):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.claim_sources",
            "Claim sources must not contain duplicates.",
        )
    for claim in item.claim_sources:
        if not _claim_source_is_eligible(request, claim):
            code = (
                "CONTENT_OFFER_UNAPPROVED"
                if claim.claim_type == "promotion"
                else _BLOCKED_CLAIM_CODES.get(
                    claim.claim_type,
                    "CONTENT_UNSUPPORTED_CLAIM",
                )
            )
            _add_output_issue(
                issues,
                code,
                "item.claim_sources",
                "Every material claim source must resolve to approved supplied grounding.",
            )
        if claim.claim_type == "promotion" and request.week_context.promotion is not None:
            starts_at = item.recommended_publish_window.starts_at
            ends_at = item.recommended_publish_window.ends_at
            promotion = request.week_context.promotion
            if (
                _is_timezone_aware(starts_at)
                and _is_timezone_aware(ends_at)
                and _is_timezone_aware(promotion.valid_from)
                and _is_timezone_aware(promotion.valid_until)
                and not (
                    promotion.valid_from <= starts_at
                    and ends_at <= promotion.valid_until
                )
            ):
                _add_output_issue(
                    issues,
                    "CONTENT_OFFER_UNAPPROVED",
                    "week_context.promotion.valid_until",
                    "Expired promotions cannot be carried into generated Content.",
                )
    issues.extend(_validate_risky_claim_text(request, item))

    if item.version_checksum != compute_content_item_checksum(item):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item.version_checksum",
            "Content item checksum must cover the exact immutable version bytes.",
        )

    if len(item.asset_ids) != len(set(item.asset_ids)):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item.asset_ids",
            "Asset references must not contain duplicates.",
        )

    for asset_id in item.asset_ids:
        asset = assets_by_id.get(asset_id)
        if asset_id not in request.week_context.approved_asset_ids and (
            asset is None or asset.kind != "generated_static"
        ):
            _add_output_issue(
                issues,
                "CONTENT_ASSET_REQUIRED",
                "item.asset_ids",
                "Drafts may reference only approved owner assets or supplied generated assets.",
            )
        if asset is None and enforce_asset_readiness:
            _add_output_issue(
                issues,
                "CONTENT_ASSET_REQUIRED",
                "item.asset_ids",
                "Every referenced asset must be supplied for the exact item version.",
            )
        elif asset is not None and asset.content_item_version_id != item.id:
            _add_output_issue(
                issues,
                "CONTENT_VERSION_CONFLICT",
                "item.asset_ids",
                "Every referenced asset must belong to the exact immutable item version.",
            )

    if item.asset_required and enforce_asset_readiness:
        ready_asset = any(
            asset is not None
            and asset.status == "ready"
            and asset.kind in {"owner_supplied", "generated_static"}
            and bool(asset.storage_key and asset.storage_key.strip())
            and bool(asset.checksum and _SHA256_PATTERN.fullmatch(asset.checksum))
            for asset in (assets_by_id.get(asset_id) for asset_id in item.asset_ids)
        )
        if not ready_asset:
            _add_output_issue(
                issues,
                "CONTENT_ASSET_REQUIRED",
                "item.asset_ids",
                "Publication-ready media must be a ready owner or generated asset with checksum.",
            )

    return issues


def validate_generated_content_pack(
    request: AiContentGenerateRequest,
    item_versions: Iterable[ContentItemVersion],
    assets: Iterable[ContentAsset] = (),
    *,
    protected_text_mutated: bool = False,
    enforce_asset_readiness: bool = True,
    enforce_item_count: bool = True,
) -> ContentValidationResult:
    """Validate the complete generated pack before it can leave FastAPI."""
    items = list(item_versions)
    issues: list[ContentValidationIssue] = []
    if enforce_item_count and not 3 <= len(items) <= 5:
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item_versions",
            "A generated Content pack must contain between 3 and 5 items.",
        )
    target_item_count = derive_target_item_count(
        request.strategy_plan.content_strategy.weekly_cadence
    )
    if (
        enforce_item_count
        and target_item_count is not None
        and 3 <= target_item_count <= 5
        and len(items) != target_item_count
    ):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item_versions",
            "Generated item count must match the explicit approved weekly cadence.",
        )
    if len({item.id for item in items}) != len(items):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item_versions",
            "A generated Content pack cannot contain duplicate item identities.",
        )
    if len({item.content_item_id for item in items}) != len(items):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_versions.content_item_id",
            "A generated Content pack cannot reuse a stable item identity.",
        )
    if len({_item_semantic_fingerprint(item) for item in items}) != len(items):
        _add_output_issue(
            issues,
            "CONTENT_SCHEMA_FAILURE",
            "item_versions",
            "A generated Content pack must contain distinct editorial items.",
        )
    missing_channels = set(request.selected_channels) - {
        item.channel for item in items
    }
    if missing_channels:
        _add_output_issue(
            issues,
            "CONTENT_CHANNEL_MISMATCH",
            "item_versions.channel",
            "The weekly Content pack must cover every requested Strategy channel.",
        )

    owner_item_texts = [_item_owner_text_blob(item) for item in items]
    for required_text in request.week_context.must_include:
        if not any(
            _must_include_is_satisfied(required_text, owner_text)
            for owner_text in owner_item_texts
        ):
            _add_output_issue(
                issues,
                "CONTENT_POLICY_VIOLATION",
                "week_context.must_include",
                "Every owner must-include instruction must appear exactly in the weekly pack.",
            )
    for forbidden_text in request.week_context.must_avoid:
        if any(
            _must_avoid_is_present(forbidden_text, owner_text)
            for owner_text in owner_item_texts
        ):
            _add_output_issue(
                issues,
                "CONTENT_POLICY_VIOLATION",
                "week_context.must_avoid",
                "Owner must-avoid text cannot appear in the weekly pack.",
            )

    asset_list = list(assets)
    assets_by_id = {asset.id: asset for asset in asset_list}
    if len(assets_by_id) != len(asset_list):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "assets",
            "Supplied Content assets must have unique immutable identities.",
        )
    for asset in asset_list:
        issues.extend(_validate_asset_record(asset))
    for index, item in enumerate(items):
        issues.extend(
            _validate_item_against_generation_request(
                request,
                item,
                assets_by_id,
                protected_text_mutated=protected_text_mutated,
                enforce_asset_readiness=enforce_asset_readiness,
            )
        )
        if item.content_item_id == item.id:
            _add_output_issue(
                issues,
                "CONTENT_VERSION_CONFLICT",
                f"item_versions[{index}].content_item_id",
                "The stable item identity must be distinct from and linked to its version identity.",
            )
    return ContentValidationResult(valid=not issues, issues=issues)


def validate_frozen_content_policy_fixture(fixture: dict[str, Any]) -> ContentValidationResult:
    """Expose the reviewed cross-object contract validator to the AI service."""
    return validate_frozen_policy_fixture(fixture)


def validate_revision_item(
    base_item_version: ContentItemVersion,
    revised_item_version: ContentItemVersion,
    generation_request: AiContentGenerateRequest | None = None,
) -> ContentValidationResult:
    """Ensure revision changes are new versions without changing locked fields."""
    issues: list[ContentValidationIssue] = []

    if revised_item_version.id == base_item_version.id:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.id",
            "A revision must create a new immutable item-version identity.",
        )
    if revised_item_version.version != base_item_version.version + 1:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.version",
            "A revision must create the next immutable item-version number.",
        )

    locked_fields = (
        ("content_item_id", base_item_version.content_item_id, revised_item_version.content_item_id),
        ("content_pack_id", base_item_version.content_pack_id, revised_item_version.content_pack_id),
        ("channel", base_item_version.channel, revised_item_version.channel),
        ("format", base_item_version.format, revised_item_version.format),
        ("language_mode", base_item_version.language_mode, revised_item_version.language_mode),
        (
            "strategy_trace.strategy_id",
            base_item_version.strategy_trace.strategy_id,
            revised_item_version.strategy_trace.strategy_id,
        ),
        (
            "strategy_trace.strategy_version",
            base_item_version.strategy_trace.strategy_version,
            revised_item_version.strategy_trace.strategy_version,
        ),
        (
            "strategy_trace.week_number",
            base_item_version.strategy_trace.week_number,
            revised_item_version.strategy_trace.week_number,
        ),
        (
            "strategy_trace.pillar_ids",
            base_item_version.strategy_trace.pillar_ids,
            revised_item_version.strategy_trace.pillar_ids,
        ),
        (
            "strategy_trace.objective",
            base_item_version.strategy_trace.objective,
            revised_item_version.strategy_trace.objective,
        ),
        (
            "strategy_trace.channel",
            base_item_version.strategy_trace.channel,
            revised_item_version.strategy_trace.channel,
        ),
        (
            "asset_required",
            base_item_version.asset_required,
            revised_item_version.asset_required,
        ),
    )
    for field, base_value, revised_value in locked_fields:
        if revised_value != base_value:
            _add_output_issue(
                issues,
                "CONTENT_VERSION_CONFLICT",
                f"item_version.{field}",
                "Revision cannot change Strategy-locked item fields.",
            )

    if not set(revised_item_version.asset_ids).issubset(base_item_version.asset_ids):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.asset_ids",
            "Revision cannot invent or attach new asset identities.",
        )

    if revised_item_version.version_checksum == base_item_version.version_checksum:
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.version_checksum",
            "A new revision must have a new version checksum.",
        )
    if (
        revised_item_version.generation_provenance.generation_run_id
        == base_item_version.generation_provenance.generation_run_id
    ):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.generation_provenance.generation_run_id",
            "A revision must record a new generation run identity.",
        )

    if (
        not _is_timezone_aware(revised_item_version.created_at)
        or not _is_timezone_aware(base_item_version.created_at)
        or revised_item_version.created_at <= base_item_version.created_at
    ):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.created_at",
            "A revision must be created after the previous immutable version.",
        )

    if revised_item_version.version_checksum != compute_content_item_checksum(
        revised_item_version
    ):
        _add_output_issue(
            issues,
            "CONTENT_VERSION_CONFLICT",
            "item_version.version_checksum",
            "Revision checksum must cover the exact immutable version bytes.",
        )

    if generation_request is not None:
        issues.extend(
            _validate_item_against_generation_request(
                generation_request,
                revised_item_version,
                {},
                protected_text_mutated=False,
                enforce_asset_readiness=False,
                expected_version=None,
            )
        )
    else:
        issues.extend(
            _validate_item_language(
                revised_item_version,
                revised_item_version.language_mode,
            )
        )
        base_text = _item_owner_text_blob(base_item_version)
        revised_text = _item_owner_text_blob(revised_item_version)
        if _PROMOTION_PATTERN.search(revised_text) and not _PROMOTION_PATTERN.search(
            base_text
        ):
            _add_output_issue(
                issues,
                "CONTENT_OFFER_UNAPPROVED",
                "item_version.caption_variants",
                "Revision cannot introduce a new promotion without its grounding snapshot.",
            )
        for pattern, code in _RISKY_CLAIM_PATTERNS.values():
            if pattern.search(revised_text) and not pattern.search(base_text):
                _add_output_issue(
                    issues,
                    code,
                    "item_version.caption_variants",
                    "Revision cannot introduce a new risky claim without approved grounding.",
                )

    return ContentValidationResult(valid=not issues, issues=issues)
