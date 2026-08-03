"""Provider-mode deterministic checks for Phase 5 (fake provider).

These checks execute the fake ``ContentLLMProvider`` modes defined in
``providers/fake_provider.py`` and validate the resulting items and assets
without any paid or network-backed provider.
"""

from __future__ import annotations

from typing import Any

from content_contracts import ContentItemVersion

from app.providers.base import ProviderError
from tests.evaluation.content.providers.fake_provider import (
    FakeContentProvider,
    build_generation_prompt,
    build_revision_prompt,
)
from tests.evaluation.content.schema import ContentEvalCase
from tests.evaluation.content.validators.common import CheckResult


async def provider_checks(
    case: ContentEvalCase,
    fixture: dict[str, Any],
) -> list[CheckResult]:
    """Run Phase 5 fake-provider checks for a case.

    If the case has no ``provider_mode``, the checks are skipped.  Provider cases
    drive the fake provider, assert that timeouts are surfaced as retryable
    provider failures, that failed-image assets are never mislabeled as live
    generated assets, and that revisions preserve the locked prior fields.
    """
    if case.provider_mode is None:
        return []

    pack_id = _pack_id(fixture) or "pack-fake-0000-0000-0000-000000000000"
    provider = FakeContentProvider(case.provider_mode, case)

    if case.provider_mode == "timeout":
        return await _check_timeout(provider, case, fixture, pack_id)

    if case.provider_mode == "failed_image":
        return await _check_failed_image(provider, case, fixture, pack_id)

    # Normal mode: generate a pack and optionally run a revision preservation check.
    checks: list[CheckResult] = []
    items = await _generate(provider, case, fixture, pack_id)
    if items is None:
        return checks

    checks.append(_check_item_count(items, case))
    if case.failure_category == "revision_preservation":
        checks.extend(await _check_revision(provider, case, fixture, pack_id))
    return checks


async def _generate(
    provider: FakeContentProvider,
    case: ContentEvalCase,
    fixture: dict[str, Any],
    pack_id: str,
) -> list[ContentItemVersion] | None:
    """Run the fake provider's generate and return items, or None on failure."""
    prompt = build_generation_prompt(case, fixture, pack_id)
    try:
        return await provider.generate_content_pack(prompt)
    except Exception as exc:
        return None


async def _check_timeout(
    provider: FakeContentProvider,
    case: ContentEvalCase,
    fixture: dict[str, Any],
    pack_id: str,
) -> list[CheckResult]:
    """Check that the provider surfaces a retryable CONTENT_PROVIDER_FAILURE."""
    prompt = build_generation_prompt(case, fixture, pack_id)
    try:
        await provider.generate_content_pack(prompt)
        return [
            CheckResult(
                "provider_timeout",
                False,
                "provider_mode=timeout but generate_content_pack succeeded",
            )
        ]
    except ProviderError as exc:
        if exc.code == "CONTENT_PROVIDER_FAILURE" and exc.retryable:
            return [
                CheckResult(
                    "provider_timeout",
                    True,
                    "Provider timeout surfaced as retryable CONTENT_PROVIDER_FAILURE",
                )
            ]
        return [
            CheckResult(
                "provider_timeout",
                False,
                f"Provider raised {exc.code} (retryable={exc.retryable})",
            )
        ]
    except TimeoutError:
        return [
            CheckResult(
                "provider_timeout",
                True,
                "Provider raised TimeoutError",
            )
        ]


async def _check_failed_image(
    provider: FakeContentProvider,
    case: ContentEvalCase,
    fixture: dict[str, Any],
    pack_id: str,
) -> list[CheckResult]:
    """Check that failed-image assets are never labeled as live generated assets."""
    items = await _generate(provider, case, fixture, pack_id)
    if items is None:
        return [
            CheckResult(
                "asset_generation",
                False,
                "provider_mode=failed_image but generate_content_pack raised an exception",
            )
        ]

    assets = provider.generated_assets
    if not assets:
        return [
            CheckResult(
                "asset_generation",
                False,
                "provider_mode=failed_image but no assets were generated",
            )
        ]

    errors: list[str] = []
    for asset in assets:
        if asset.kind == "prompt_only" and asset.status == "ready":
            errors.append(
                f"prompt-only asset {asset.id} is labeled as ready/live generated"
            )
        if asset.status == "failed" and asset.failure_code != "CONTENT_PROVIDER_FAILURE":
            errors.append(
                f"provider-failed asset {asset.id} has failure_code={asset.failure_code}"
            )
        if asset.status == "ready" and asset.kind == "generated_static":
            if not asset.checksum or not asset.storage_key:
                errors.append(
                    f"generated_static asset {asset.id} is ready but missing checksum/storage_key"
                )

    # The item must also carry a provider-failure blocker so downstream stages
    # never treat this as publishable.
    items_with_blocker = [
        item
        for item in items
        if item.asset_required and "CONTENT_PROVIDER_FAILURE" in item.blockers
    ]
    if not items_with_blocker:
        errors.append(
            "no asset_required item has a CONTENT_PROVIDER_FAILURE blocker"
        )

    if errors:
        return [
            CheckResult(
                "asset_generation",
                False,
                "; ".join(errors),
            )
        ]
    return [
        CheckResult(
            "asset_generation",
            True,
            "Failed image assets are correctly labeled and never marked as live generated",
        )
    ]


async def _check_revision(
    provider: FakeContentProvider,
    case: ContentEvalCase,
    fixture: dict[str, Any],
    pack_id: str,
) -> list[CheckResult]:
    """Check that a revision preserves the locked prior fields."""
    if fixture.get("is_week_context_only"):
        return [
            CheckResult(
                "revision_preserves_strategy_trace",
                False,
                "cannot run revision on a week-context-only fixture",
            )
        ]

    item_version = fixture.get("item_version")
    if item_version is None:
        return [
            CheckResult(
                "revision_preserves_strategy_trace",
                False,
                "fixture has no item_version to revise",
            )
        ]

    previous = ContentItemVersion.model_validate(item_version)
    prompt = build_revision_prompt(
        case,
        fixture,
        previous,
        pack_id,
        revision_notes="Concise revision for eval harness.",
    )
    try:
        revised = await provider.revise_content_item(prompt)
    except Exception as exc:
        return [
            CheckResult(
                "revision_preserves_strategy_trace",
                False,
                f"revise_content_item raised: {exc}",
            )
        ]

    checks = [
        CheckResult(
            "revision_preserves_caption",
            all(
                any(old.caption == new.caption for new in revised.caption_variants)
                for old in previous.caption_variants
            ),
            "Caption variants preserved" if all(
                any(old.caption == new.caption for new in revised.caption_variants)
                for old in previous.caption_variants
            ) else "Caption variants were mutated",
        ),
        CheckResult(
            "revision_preserves_creative_brief",
            revised.creative_brief == previous.creative_brief,
            "Creative brief preserved"
            if revised.creative_brief == previous.creative_brief
            else "Creative brief was mutated",
        ),
        CheckResult(
            "revision_preserves_alt_text",
            revised.alt_text == previous.alt_text,
            "Alt text preserved"
            if revised.alt_text == previous.alt_text
            else "Alt text was mutated",
        ),
        CheckResult(
            "revision_preserves_asset_ids",
            revised.asset_ids == previous.asset_ids,
            "Asset IDs preserved"
            if revised.asset_ids == previous.asset_ids
            else "Asset IDs were mutated",
        ),
        CheckResult(
            "revision_preserves_strategy_trace",
            revised.strategy_trace == previous.strategy_trace,
            "Strategy trace preserved"
            if revised.strategy_trace == previous.strategy_trace
            else "Strategy trace was mutated",
        ),
    ]
    return checks


def _check_item_count(
    items: list[ContentItemVersion],
    case: ContentEvalCase,
) -> CheckResult:
    """Check that normal-mode output respects the Strategy content count."""
    expected = case.strategy_snapshot.content_count
    if len(items) == expected:
        return CheckResult(
            "provider_item_count",
            True,
            f"Provider returned {len(items)} items as expected",
        )
    return CheckResult(
        "provider_item_count",
        False,
        f"Expected {expected} items, got {len(items)}",
    )


def _pack_id(fixture: dict[str, Any]) -> str | None:
    """Return the pack ID from a fixture dict, or None."""
    if fixture.get("is_week_context_only"):
        return None
    pack = fixture.get("pack")
    if pack:
        return pack.get("id")
    return None
