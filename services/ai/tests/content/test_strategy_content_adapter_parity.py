"""Cross-language parity for the NestJS Strategy→Content format adapter.

The deterministic adapter lives in NestJS
(`apps/api/src/modules/content/content-strategy.adapter.ts`). This test
mirrors its reviewed MVP mapping table in Python and proves the adapter's
deterministic output for the canonical `strategy-plan.example.json` is
accepted by the FastAPI Pydantic `AiContentGenerateRequest` model:

- every week maps to a non-empty set of valid `ContentFormat` values;
- week 1 (`reels`, `photo`, `poll`) maps to
  `["short_video_script", "static_image_post", "text_post"]` — the exact
  order asserted by the TypeScript adapter spec;
- an all-unknown week fails closed (raises) rather than falling back to
  every supported format;
- a request built with each week's mapped `allowed_formats` validates
  against `AiContentGenerateRequest`.

Holding both languages to the same canonical fixture keeps the adapter and
the FastAPI grounding snapshot from drifting (issue #110 P1).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from content_contracts import AiContentGenerateRequest, ContentWeekContext
from strategy_contracts import BusinessProfilePayload, StrategyPlan

from tests.content.fixture_helpers import load_example

# Reviewed MVP mapping — must stay byte-for-byte identical to the TypeScript
# `STRATEGY_LABEL_TO_CONTENT_FORMAT` table in content-strategy.adapter.ts.
STRATEGY_LABEL_TO_CONTENT_FORMAT: dict[str, str] = {
    "static_image_post": "static_image_post",
    "static_image": "static_image_post",
    "photo": "static_image_post",
    "image": "static_image_post",
    "story": "static_image_post",
    "short_video_script": "short_video_script",
    "short_video": "short_video_script",
    "video": "short_video_script",
    "reel": "short_video_script",
    "reels": "short_video_script",
    "carousel_brief": "carousel_brief",
    "carousel": "carousel_brief",
    "text_post": "text_post",
    "text": "text_post",
    "post": "text_post",
    "caption": "text_post",
    "poll": "text_post",
    "quiz": "text_post",
    "question": "text_post",
}

CONTENT_FORMATS = (
    "static_image_post",
    "short_video_script",
    "carousel_brief",
    "text_post",
)

EXPECTED_WEEK_MAPPING: dict[int, list[str]] = {
    1: ["short_video_script", "static_image_post", "text_post"],
    2: ["short_video_script", "static_image_post"],
    3: ["short_video_script", "static_image_post"],
    4: ["short_video_script", "static_image_post"],
    5: ["short_video_script", "static_image_post", "text_post"],
    6: ["short_video_script", "text_post"],
    7: ["short_video_script", "static_image_post"],
    8: ["short_video_script", "static_image_post", "text_post"],
    9: ["static_image_post"],
    10: ["short_video_script", "static_image_post"],
    11: ["short_video_script", "static_image_post"],
    12: ["short_video_script", "text_post", "static_image_post"],
}


class SchemaAdapterFailure(ValueError):
    """Mirrors the NestJS non-retryable CONTENT_SCHEMA_FAILURE fail-close."""


def normalize_label(raw: str) -> str:
    return raw.strip().lower().replace(" ", "_").replace("-", "_")


def map_label(raw: str) -> str | None:
    normalized = normalize_label(raw)
    if normalized in CONTENT_FORMATS:
        return normalized
    return STRATEGY_LABEL_TO_CONTENT_FORMAT.get(normalized)


def adapt_week_formats(plan: dict, week_number: int) -> list[str]:
    content_strategy = plan.get("content_strategy")
    if not isinstance(content_strategy, dict):
        raise SchemaAdapterFailure("missing content_strategy")
    weeks = content_strategy.get("weeks")
    if not isinstance(weeks, list) or not weeks:
        raise SchemaAdapterFailure("missing content_strategy.weeks")
    week_plan = next(
        (w for w in weeks if isinstance(w, dict) and str(w.get("week_number")) == str(week_number)),
        None,
    )
    if not isinstance(week_plan, dict):
        raise SchemaAdapterFailure(f"missing week {week_number}")
    formats = week_plan.get("formats")
    if not isinstance(formats, list) or not formats:
        raise SchemaAdapterFailure(f"missing formats for week {week_number}")
    mapped: list[str] = []
    for raw in formats:
        if not isinstance(raw, str):
            continue
        mapped_format = map_label(raw)
        if mapped_format is None:
            continue
        if mapped_format not in mapped:
            mapped.append(mapped_format)
    if not mapped:
        raise SchemaAdapterFailure(f"no supported formats for week {week_number}")
    return mapped


@pytest.fixture(scope="module")
def strategy_plan() -> dict:
    return load_example("strategy-plan.example.json")


def test_every_example_week_maps_to_non_empty_supported_set(strategy_plan: dict) -> None:
    weeks = strategy_plan["content_strategy"]["weeks"]
    assert len(weeks) == 12
    for week in weeks:
        mapped = adapt_week_formats(strategy_plan, week["week_number"])
        assert mapped, f"week {week['week_number']} produced no formats"
        assert all(f in CONTENT_FORMATS for f in mapped)


def test_week_1_mapping_matches_typescript_assertion(strategy_plan: dict) -> None:
    assert adapt_week_formats(strategy_plan, 1) == [
        "short_video_script",
        "static_image_post",
        "text_post",
    ]


@pytest.mark.parametrize(
    "week_number",
    sorted(EXPECTED_WEEK_MAPPING),
)
def test_deterministic_mapping_matches_reference(strategy_plan: dict, week_number: int) -> None:
    assert adapt_week_formats(strategy_plan, week_number) == EXPECTED_WEEK_MAPPING[week_number]


def test_all_unknown_week_fails_closed(strategy_plan: dict) -> None:
    plan = {
        "content_strategy": {
            "weeks": [{"week_number": 1, "theme": "t", "formats": ["hologram", "drone_show"]}],
        }
    }
    with pytest.raises(SchemaAdapterFailure):
        adapt_week_formats(plan, 1)


def test_missing_content_strategy_fails_closed() -> None:
    with pytest.raises(SchemaAdapterFailure):
        adapt_week_formats({}, 1)
    with pytest.raises(SchemaAdapterFailure):
        adapt_week_formats({"content_strategy": {}}, 1)


def _make_profile(plan: StrategyPlan) -> BusinessProfilePayload:
    return BusinessProfilePayload(
        id=plan.profile_version.business_profile_version_id,
        business_id="11111111-1111-4111-8111-111111111111",
        version=plan.profile_version.version,
        profile={"business_name": "Koshary Corner"},
        confirmed_by_user_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        confirmed_at=plan.profile_version.confirmed_at,
        created_at=plan.profile_version.confirmed_at,
    )


@pytest.mark.parametrize(
    "week_number",
    sorted(EXPECTED_WEEK_MAPPING),
)
def test_fastapi_accepts_adapted_request_for_every_week(
    strategy_plan: dict, week_number: int
) -> None:
    plan = StrategyPlan.model_validate(strategy_plan)
    # Build a valid ContentWeekContext for the requested week from the safe-default
    # example (its calendar shape is valid for any week number in 1-12).
    context = ContentWeekContext.model_validate(
        {**load_example("content-week-context-safe-default.example.json"), "week_number": week_number}
    )
    request = AiContentGenerateRequest(
        contract_version="content-v1",
        content_pack_id="77777777-7777-4777-8777-777777777777",
        business_id=_make_profile(plan).business_id,
        strategy_id=plan.strategy_id,
        strategy_version=plan.version,
        strategy_decision_id="55555555-5555-4555-8555-555555555555",
        strategy_plan=plan,
        business_profile=_make_profile(plan),
        week_context=context,
        selected_channels=["instagram"],
        allowed_formats=adapt_week_formats(strategy_plan, week_number),
        language_mode=plan.plan_language.value,
    )
    # Must parse and match the grounding snapshot identity invariants.
    assert request.allowed_formats == EXPECTED_WEEK_MAPPING[week_number]
    assert request.strategy_id == plan.strategy_id
    assert request.strategy_version == plan.version


def test_fastapi_rejects_request_with_unsupported_format() -> None:
    """A format outside content-v1 must be rejected — proves the adapter output
    is constrained to the four exact formats the FastAPI model accepts."""
    plan = StrategyPlan.model_validate(load_example("strategy-plan.example.json"))
    context = ContentWeekContext.model_validate(
        load_example("content-week-context-safe-default.example.json")
    )
    with pytest.raises(ValidationError):
        AiContentGenerateRequest(
            contract_version="content-v1",
            content_pack_id="77777777-7777-4777-8777-777777777777",
            business_id=_make_profile(plan).business_id,
            strategy_id=plan.strategy_id,
            strategy_version=plan.version,
            strategy_decision_id="55555555-5555-4555-8555-555555555555",
            strategy_plan=plan,
            business_profile=_make_profile(plan),
            week_context=context,
            selected_channels=["instagram"],
            allowed_formats=["photon_stream"],  # unsupported
            language_mode=plan.plan_language.value,
        )