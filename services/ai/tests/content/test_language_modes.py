"""Arabic, English, mixed-language, and protected-text evaluation cases."""

from __future__ import annotations

import asyncio

import pytest

from app.content.assembler import assemble_generation_prompt
from app.content.validators import validate_generated_content_pack
from app.providers.content_provider import MockContentProvider
from tests.content.fixture_helpers import make_valid_request


def _request_for_language(language_mode: str):
    request = make_valid_request().model_copy(
        update={"language_mode": language_mode, "allowed_formats": ["text_post"]}
    )
    plan = request.strategy_plan
    if language_mode == "en":
        first_week = plan.content_strategy.weeks[0].model_copy(
            update={"theme": "Weekly local customer focus"}
        )
        roadmap = plan.content_strategy.model_copy(
            update={"weeks": [first_week, *plan.content_strategy.weeks[1:]]}
        )
        plan = plan.model_copy(update={"plan_language": "en", "content_strategy": roadmap})
    else:
        plan = plan.model_copy(update={"plan_language": language_mode})
    return request.model_copy(update={"strategy_plan": plan})


@pytest.mark.parametrize("language_mode", ["ar-EG", "en", "mixed"])
def test_mock_generation_matches_requested_language_mode(language_mode: str) -> None:
    request = _request_for_language(language_mode)
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))

    result = validate_generated_content_pack(request, items)

    assert result.valid
    assert all(item.language_mode == language_mode for item in items)
    if language_mode == "mixed":
        assert all({"ar", "en"} <= {variant.locale for variant in item.caption_variants} for item in items)


def test_arabic_output_with_english_owner_facing_copy_is_blocked() -> None:
    request = _request_for_language("ar-EG")
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))
    items[0] = items[0].model_copy(
        update={
            "creative_brief": "Create a clear product image for the customer.",
            "alt_text": "Product image for customers",
        }
    )

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert any(
        issue.code == "CONTENT_SCHEMA_FAILURE"
        and "creative_brief" in issue.field
        for issue in result.issues
    )


def test_english_output_with_arabic_caption_is_blocked() -> None:
    request = _request_for_language("en")
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))
    original = items[0].caption_variants[0]
    items[0] = items[0].model_copy(
        update={
            "caption_variants": [
                original.model_copy(update={"caption": "هذا نص عربي بالكامل للعملاء."})
            ]
        }
    )

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert any(
        issue.code == "CONTENT_SCHEMA_FAILURE"
        and "caption_variants" in issue.field
        for issue in result.issues
    )


def test_mixed_output_requires_both_caption_locales() -> None:
    request = _request_for_language("mixed")
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))
    items[0] = items[0].model_copy(
        update={
            "caption_variants": [
                variant
                for variant in items[0].caption_variants
                if variant.locale == "ar"
            ]
        }
    )

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert any(
        issue.code == "CONTENT_SCHEMA_FAILURE"
        and "caption_variants" in issue.field
        for issue in result.issues
    )


def test_english_short_video_script_is_fully_english() -> None:
    request = _request_for_language("en").model_copy(
        update={"allowed_formats": ["short_video_script"]}
    )
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))

    result = validate_generated_content_pack(request, items)

    assert result.valid
    assert all(item.short_video_script is not None for item in items)


def test_approved_promotion_text_and_terms_are_preserved_by_mock() -> None:
    request = _request_for_language("ar-EG")
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))
    promotion = request.week_context.promotion
    assert promotion is not None

    caption_text = items[0].caption_variants[0].caption
    assert promotion.text in caption_text
    assert all(term in caption_text for term in promotion.terms)
