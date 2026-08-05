"""Post-generation grounding, policy, and asset validation tests."""

from __future__ import annotations

import asyncio

import pytest

from content_contracts import (
    ContentAsset,
    ContentClaimSource,
)

from app.content.assembler import assemble_generation_prompt
from app.content.validators import (
    compute_content_item_checksum,
    validate_frozen_content_policy_fixture,
    validate_generated_content_pack,
)
from app.providers.content_provider import MockContentProvider
from tests.content.fixture_helpers import load_example, make_valid_request


def _generated_text_items():
    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))
    return request, items


def _asset_for(item, *, status: str = "ready", kind: str = "owner_supplied") -> ContentAsset:
    return ContentAsset(
        id=item.asset_ids[0] if item.asset_ids else "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        content_item_version_id=item.id,
        kind=kind,
        status=status,
        mime_type="image/jpeg" if status == "ready" else None,
        storage_key="content/test/asset.jpg" if status == "ready" else None,
        checksum="sha256-test-asset" if status == "ready" else None,
        width=1080 if status == "ready" else None,
        height=1080 if status == "ready" else None,
        alt_text=item.alt_text,
        provider_name=None,
        provider_model=None,
        provider_request_id=None,
        failure_code=None,
        review_required=kind == "generated_static",
        created_at=item.created_at,
    )


def _rehash(item):
    staged = item.model_copy(update={"version_checksum": ""})
    return staged.model_copy(
        update={"version_checksum": compute_content_item_checksum(staged)}
    )


def test_valid_generated_text_pack_passes() -> None:
    request, items = _generated_text_items()

    result = validate_generated_content_pack(request, items)

    assert result.valid
    assert result.issues == []


@pytest.mark.parametrize(
    ("mutation", "expected_code"),
    [
        ("channel", "CONTENT_CHANNEL_MISMATCH"),
        ("format", "CONTENT_SCHEMA_FAILURE"),
        ("language", "CONTENT_SCHEMA_FAILURE"),
        ("strategy", "CONTENT_VERSION_CONFLICT"),
        ("week", "CONTENT_VERSION_CONFLICT"),
        ("pillar", "CONTENT_VERSION_CONFLICT"),
    ],
)
def test_generated_item_must_match_grounding_request(
    mutation: str,
    expected_code: str,
) -> None:
    request, items = _generated_text_items()
    item = items[0]
    trace = item.strategy_trace
    updates = {}
    trace_updates = {}
    if mutation == "channel":
        updates["channel"] = "facebook"
        trace_updates["channel"] = "facebook"
    elif mutation == "format":
        updates["format"] = "static_image_post"
    elif mutation == "language":
        updates["language_mode"] = "en"
    elif mutation == "strategy":
        trace_updates["strategy_version"] = 2
    elif mutation == "week":
        trace_updates["week_number"] = 2
    elif mutation == "pillar":
        trace_updates["pillar_ids"] = []
    if trace_updates:
        updates["strategy_trace"] = trace.model_copy(update=trace_updates)
    items[0] = item.model_copy(update=updates)

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert expected_code in {issue.code for issue in result.issues}


def test_unsupported_claim_is_blocked() -> None:
    request, items = _generated_text_items()
    item = items[0]
    claim = ContentClaimSource(
        claim_type="guarantee",
        source_type="strategy",
        source_path="strategy_plan.content_strategy",
        approved=False,
    )
    items[0] = item.model_copy(update={"claim_sources": [*item.claim_sources, claim]})

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert "CONTENT_POLICY_VIOLATION" in {issue.code for issue in result.issues}


def test_risky_copy_without_matching_claim_source_is_blocked() -> None:
    request, items = _generated_text_items()
    item = items[0]
    variant = item.caption_variants[0]
    mutated = item.model_copy(
        update={
            "caption_variants": [
                variant.model_copy(
                    update={
                        "caption": f"{variant.caption} نضمن لك الشفاء التام بنسبة ٩٠ بالمئة."
                    }
                )
            ]
        }
    )
    items[0] = _rehash(mutated)

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert "CONTENT_POLICY_VIOLATION" in {issue.code for issue in result.issues}


def test_invented_opening_hours_are_blocked() -> None:
    request, items = _generated_text_items()
    item = items[0]
    variant = item.caption_variants[0]
    mutated = item.model_copy(
        update={
            "caption_variants": [
                variant.model_copy(
                    update={
                        "caption": f"{variant.caption} نحن مفتوحون يوميًا من الساعة ٩."
                    }
                )
            ]
        }
    )
    items[0] = _rehash(mutated)

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert "CONTENT_UNSUPPORTED_CLAIM" in {
        issue.code for issue in result.issues
    }

def test_risky_claim_must_preserve_the_exact_grounded_value() -> None:
    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    profile_data = dict(request.business_profile.profile)
    profile_data["price"] = "50 جنيه"
    profile = request.business_profile.model_copy(update={"profile": profile_data})
    request = request.model_copy(update={"business_profile": profile})
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))
    item = items[0]
    variant = item.caption_variants[0]
    price_claim = ContentClaimSource(
        claim_type="price",
        source_type="profile",
        source_path="business_profile.profile.price",
        approved=True,
    )
    mutated = item.model_copy(
        update={
            "caption_variants": [
                variant.model_copy(
                    update={"caption": f"{variant.caption} السعر 150 جنيه."}
                )
            ],
            "claim_sources": [*item.claim_sources, price_claim],
        }
    )
    items[0] = _rehash(mutated)

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert "CONTENT_UNSUPPORTED_CLAIM" in {
        issue.code for issue in result.issues
    }

    grounded_variant = variant.model_copy(
        update={"caption": f"{variant.caption} السعر 50 جنيه."}
    )
    grounded = item.model_copy(
        update={
            "caption_variants": [grounded_variant],
            "claim_sources": [*item.claim_sources, price_claim],
        }
    )
    items[0] = _rehash(grounded)

    grounded_result = validate_generated_content_pack(request, items)

    assert grounded_result.valid


def test_duplicate_stable_item_identity_is_rejected() -> None:
    request, items = _generated_text_items()
    items[1] = _rehash(
        items[1].model_copy(update={"content_item_id": items[0].content_item_id})
    )

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    assert any("content_item_id" in issue.field for issue in result.issues)


def test_strategy_objective_and_version_checksum_are_enforced() -> None:
    request, items = _generated_text_items()
    trace = items[0].strategy_trace.model_copy(update={"objective": "invented"})
    items[0] = _rehash(items[0].model_copy(update={"strategy_trace": trace}))
    items[1] = items[1].model_copy(update={"version_checksum": "tampered"})

    result = validate_generated_content_pack(request, items)

    assert not result.valid
    fields = {issue.field for issue in result.issues}
    assert "item.strategy_trace.objective" in fields
    assert "item.version_checksum" in fields


def test_protected_text_mutation_is_blocked_when_reported() -> None:
    request, items = _generated_text_items()

    result = validate_generated_content_pack(
        request,
        items,
        protected_text_mutated=True,
    )

    assert not result.valid
    assert "CONTENT_POLICY_VIOLATION" in {issue.code for issue in result.issues}


def test_required_static_asset_needs_ready_checksum_addressed_media() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))

    missing_result = validate_generated_content_pack(request, items)
    ready_assets = [_asset_for(items[0])]
    ready_result = validate_generated_content_pack(request, items, ready_assets)

    assert not missing_result.valid
    assert "CONTENT_ASSET_REQUIRED" in {
        issue.code for issue in missing_result.issues
    }
    assert not ready_result.valid
    # The other generated items reference their own approved asset IDs and are
    # intentionally still blocked until each exact item has ready media.
    assert "CONTENT_VERSION_CONFLICT" in {issue.code for issue in ready_result.issues}


def test_static_media_can_leave_fastapi_as_a_truthful_draft() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))

    result = validate_generated_content_pack(
        request,
        items,
        enforce_asset_readiness=False,
    )

    assert result.valid


def test_prompt_only_asset_cannot_satisfy_required_media() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    items = asyncio.run(MockContentProvider().generate_content_pack(prompt))
    assets = [_asset_for(items[0], status="failed", kind="prompt_only")]

    result = validate_generated_content_pack(request, items, assets)

    assert not result.valid
    assert "CONTENT_ASSET_REQUIRED" in {issue.code for issue in result.issues}


def test_frozen_policy_validator_is_available_at_ai_boundary() -> None:
    fixture = load_example("content-pack-week-1-ar.example.json")
    result = validate_frozen_content_policy_fixture(fixture)

    assert result.valid
    assert result.issues == []


def test_frozen_policy_validator_preserves_stable_invalid_codes() -> None:
    fixture = load_example("content-pack-week-1-ar.example.json")
    fixture["strategy_status"] = "draft"
    result = validate_frozen_content_policy_fixture(fixture)

    assert not result.valid
    assert "CONTENT_STRATEGY_NOT_APPROVED" in {issue.code for issue in result.issues}
