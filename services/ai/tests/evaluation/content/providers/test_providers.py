"""Phase 5 fake ContentLLMProvider mode tests.

These tests prove the local fake provider satisfies the #108 provider interface,
surfaces timeouts and failed-image generation correctly, and preserves the locked
prior fields during revision.  No paid provider or network is used.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, UTC

import pytest

from content_contracts import ContentAsset, ContentItemVersion

from app.providers.base import ProviderError
from tests.evaluation.content.providers.fake_provider import (
    FakeContentProvider,
    build_generation_prompt,
    build_revision_prompt,
)
from tests.evaluation.content.runner.runner import load_all_cases
from tests.evaluation.content.validators.content_validator import (
    _load_policy_fixture_dict,
    validate_case,
)


def _load_case(case_id: str):
    for case in load_all_cases():
        if case.case_id == case_id:
            return case
    raise ValueError(f"case {case_id} not found")


def _pack_id(fixture: dict) -> str:
    if fixture.get("is_week_context_only"):
        return "pack-fake-0000-0000-0000-000000000000"
    return fixture["pack"]["id"]


@pytest.mark.asyncio
async def test_provider_timeout_raises_retryable_provider_error() -> None:
    case = _load_case("mutation-provider-timeout")
    fixture = _load_policy_fixture_dict(case)
    prompt = build_generation_prompt(case, fixture, _pack_id(fixture))
    provider = FakeContentProvider("timeout", case)

    with pytest.raises(ProviderError) as exc_info:
        await provider.generate_content_pack(prompt)

    assert exc_info.value.code == "CONTENT_PROVIDER_FAILURE"
    assert exc_info.value.retryable is True


@pytest.mark.asyncio
async def test_provider_failed_image_generates_failed_assets() -> None:
    case = _load_case("mutation-failed-image-generation")
    fixture = _load_policy_fixture_dict(case)
    prompt = build_generation_prompt(case, fixture, _pack_id(fixture))
    provider = FakeContentProvider("failed_image", case)

    items = await provider.generate_content_pack(prompt)
    assets = provider.generated_assets

    assert len(items) > 0
    assert len(assets) > 0
    for asset in assets:
        assert asset.status == "failed"
        assert asset.failure_code == "CONTENT_PROVIDER_FAILURE"
        assert asset.kind == "generated_static"

    asset_required_items = [item for item in items if item.asset_required]
    assert asset_required_items
    for item in asset_required_items:
        assert "CONTENT_PROVIDER_FAILURE" in item.blockers


@pytest.mark.asyncio
async def test_provider_failed_image_never_mislabels_prompt_only_as_live() -> None:
    case = _load_case("mutation-failed-image-generation")
    fixture = _load_policy_fixture_dict(case)
    prompt = build_generation_prompt(case, fixture, _pack_id(fixture))
    provider = FakeContentProvider("failed_image", case)

    await provider.generate_content_pack(prompt)

    for asset in provider.generated_assets:
        if asset.kind == "prompt_only":
            assert asset.status != "ready", "prompt-only asset labeled as live"
        if asset.status == "ready" and asset.kind == "generated_static":
            assert asset.checksum and asset.storage_key, "generated live asset missing credentials"


@pytest.mark.asyncio
async def test_provider_normal_generates_valid_items() -> None:
    case = _load_case("mutation-revision-preservation")
    fixture = _load_policy_fixture_dict(case)
    prompt = build_generation_prompt(case, fixture, _pack_id(fixture))
    provider = FakeContentProvider("normal", case)

    items = await provider.generate_content_pack(prompt)

    assert len(items) == case.strategy_snapshot.content_count
    for item in items:
        assert item.version_checksum
        assert item.caption_variants
        assert item.creative_brief


@pytest.mark.asyncio
async def test_provider_revision_preserves_locked_fields() -> None:
    case = _load_case("mutation-revision-preservation")
    fixture = _load_policy_fixture_dict(case)
    previous_item = ContentItemVersion.model_validate(fixture["item_version"])
    prompt = build_revision_prompt(
        case,
        fixture,
        previous_item,
        _pack_id(fixture),
    )
    provider = FakeContentProvider("normal", case)

    revised = await provider.revise_content_item(prompt)

    assert str(revised.id) != str(previous_item.id)
    assert revised.version == previous_item.version + 1
    assert revised.creative_brief == previous_item.creative_brief
    assert revised.alt_text == previous_item.alt_text
    assert revised.asset_ids == previous_item.asset_ids
    assert revised.strategy_trace == previous_item.strategy_trace
    assert all(
        any(old.caption == new.caption for new in previous_item.caption_variants)
        for old in revised.caption_variants
    )


def test_provider_timeout_validator_check() -> None:
    case = _load_case("mutation-provider-timeout")
    result = validate_case(case)
    timeout_check = next(c for c in result.checks if c.name == "provider_timeout")
    assert timeout_check.passed


def test_provider_failed_image_validator_check() -> None:
    case = _load_case("mutation-failed-image-generation")
    result = validate_case(case)
    asset_check = next(c for c in result.checks if c.name == "asset_generation")
    assert asset_check.passed


def test_provider_revision_validator_checks() -> None:
    case = _load_case("mutation-revision-preservation")
    result = validate_case(case)
    for name in (
        "revision_preserves_caption",
        "revision_preserves_creative_brief",
        "revision_preserves_alt_text",
        "revision_preserves_asset_ids",
        "revision_preserves_strategy_trace",
    ):
        check = next((c for c in result.checks if c.name == name), None)
        assert check is not None, f"missing {name}"
        assert check.passed, f"{name} failed: {check.reason}"


def test_provider_execution_in_report() -> None:
    case = _load_case("mutation-provider-timeout")
    result = validate_case(case)
    assert result.checked
    provider_names = {c.name for c in result.checks}
    assert "provider_timeout" in provider_names


class MislabeledAssetProvider(FakeContentProvider):
    """Fake provider that intentionally returns a prompt-only asset labeled ready."""

    async def generate_content_pack(self, prompt):
        items = await super().generate_content_pack(prompt)
        self._generated_assets = [
            ContentAsset(
                id="asset-bad-0000-0000-0000-000000000000",
                content_item_version_id=str(items[0].id),
                kind="prompt_only",
                status="ready",
                mime_type="image/jpeg",
                storage_key=None,
                checksum=None,
                width=1080,
                height=1080,
                alt_text="Simulated placeholder",
                provider_name="fake-content",
                provider_model="fake-image-model",
                provider_request_id=None,
                failure_code=None,
                created_at=datetime.now(UTC),
            )
        ]
        return items


@pytest.mark.asyncio
async def test_prompt_only_asset_labeled_ready_is_rejected() -> None:
    """Zero tolerance for prompt-only asset labeled as a generated live asset."""
    from tests.evaluation.content.validators.provider_validator import (
        _check_failed_image,
    )

    case = _load_case("mutation-failed-image-generation")
    fixture = _load_policy_fixture_dict(case)
    provider = MislabeledAssetProvider("failed_image", case)

    results = await _check_failed_image(provider, case, fixture, _pack_id(fixture))
    asset_generation = next(c for c in results if c.name == "asset_generation")
    assert not asset_generation.passed
    assert "prompt-only" in asset_generation.reason
