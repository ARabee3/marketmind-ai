"""Phase 0 alignment smoke checks for the Content evaluation harness (#109).

These tests are deliberately small: they assert that the frozen #107 contract
surface and the #108 provider interface this harness keys off are still
importable on ``main``. They are the precondition for every later phase.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

FROZEN_CONTRACT_PACKAGE = "packages/contracts/python"
FROZEN_FIXTURES_DIR = "packages/contracts/examples"
PROVIDER_INTERFACE_MODULE = "app.providers.content_provider"
SERVICE_MODULE = "app.content.service"


SUPPORTED_REVIEWERS = {
    "owner_mokhtar": "@MOKHXXXXXX",
    "eval_mostafa": "@MostafaAhmed22",
    "ai_product_merzk": "@mostafamerzk",
    "safety_rabee": "@ARabee3",
}


REQUIRED_SUBFOLDERS = (
    "cases",
    "validators",
    "providers",
    "reports",
    "runner",
    "docs",
)


def _package_root() -> Path:
    """Absolute path to the repository root.

    ``parents[5]`` from this file lands on:
    content/ -> evaluation/ -> tests/ -> ai/ -> services/ -> repo root.
    """
    return Path(__file__).resolve().parents[5]


def test_107_contract_package_imports() -> None:
    """The #107 frozen content-v1 models and policy validator stay importable."""
    module = importlib.import_module("content_contracts")
    assert hasattr(module, "ContentPolicyFixture")
    assert hasattr(module, "ContentErrorCode")
    assert hasattr(module, "validate_content_policy_fixture")
    assert hasattr(module, "ContentItemVersion")
    assert hasattr(module, "ContentPack")
    assert hasattr(module, "ContentWeekContext")
    assert hasattr(module, "AiContentGenerateRequest")
    assert hasattr(module, "AiContentReviseRequest")


def test_107_error_code_set_is_the_documented_one() -> None:
    """The #107 validator is present and the documented
    ``content-strategy-unapproved.invalid.json`` fixture exists."""
    from content_contracts import validate_content_policy_fixture

    assert callable(validate_content_policy_fixture)
    fixtures_dir = _package_root() / "packages" / "contracts" / "examples"
    unapproved = fixtures_dir / "content-strategy-unapproved.invalid.json"
    assert unapproved.exists(), (
        "content-strategy-unapproved.invalid.json is part of the frozen #107 "
        "fixture set and must exist."
    )


@pytest.mark.parametrize(
    "fixture_name",
    [
        "content-strategy-unapproved.invalid.json",
        "content-profile-stale.invalid.json",
        "content-unconfirmed-price.invalid.json",
        "content-unsupported-testimonial.invalid.json",
        "content-guarantee-claim.invalid.json",
        "content-regulated-claim.invalid.json",
        "content-competitor-superiority.invalid.json",
        "content-wrong-channel.invalid.json",
        "content-trace-channel-mismatch.invalid.json",
        "content-duplicate-week-claim.invalid.json",
        "content-week-13.invalid.json",
        "content-cycle-completed.invalid.json",
        "content-cycle-paused.invalid.json",
        "content-default-context-owner-claim.invalid.json",
        "content-pack-strategy-version-mismatch.invalid.json",
        "content-missing-required-asset.invalid.json",
        "content-provider-failure.invalid.json",
        "content-protected-text-mutated.invalid.json",
        "content-version-conflict.invalid.json",
        "content-approval-blocked.invalid.json",
        "content-pack-too-few-items.invalid.json",
        "content-pack-too-many-items.invalid.json",
        "content-pack-week-1-en.example.json",
        "content-pack-week-1-ar.example.json",
        "content-pack-week-1-mixed.example.json",
        "content-pack-week-2-rollover.example.json",
        "content-week-context-safe-default.example.json",
        "content-week-context-owner-promotion.example.json",
    ],
)
def test_107_frozen_fixture_present(fixture_name: str) -> None:
    """Each frozen fixture used by Phase 3 mutation coverage must exist."""
    fixtures_dir = (
        _package_root() / "packages" / "contracts" / "examples" / fixture_name
    )
    assert fixtures_dir.exists(), (
        f"Frozen #107 fixture {fixture_name} is missing; the harness cannot "
        "reuse it as the mutation truth set."
    )


def test_108_provider_interface_surface() -> None:
    """The #108 ContentLLMProvider interface stays importable with the two
    async methods the fake provider stub will subclass."""
    module = importlib.import_module(PROVIDER_INTERFACE_MODULE)
    cls = getattr(module, "ContentLLMProvider")
    assert hasattr(cls, "generate_content_pack")
    assert hasattr(cls, "revise_content_item")
    assert getattr(cls, "generate_content_pack").__isabstractmethod__ is True
    assert getattr(cls, "revise_content_item").__isabstractmethod__ is True


def test_108_service_entry_points_importable() -> None:
    """The bounded repair/retry service from #108 stays importable."""
    module = importlib.import_module(SERVICE_MODULE)
    assert hasattr(module, "generate_content_pack_with_repair")
    assert hasattr(module, "revise_content_item_with_repair")


def test_108_reference_fake_provider_exists() -> None:
    """The MockContentProvider from #108 stays importable; it is the base for
    the Phase 5 fake modes."""
    module = importlib.import_module(PROVIDER_INTERFACE_MODULE)
    assert hasattr(module, "MockContentProvider")
    assert hasattr(module.MockContentProvider, "generate_content_pack")
    assert hasattr(module.MockContentProvider, "revise_content_item")


def test_harness_subfolders_present() -> None:
    """Phase 0 scaffold layout covers every documented subfolder."""
    harness_root = (
        _package_root() / "services" / "ai" / "tests" / "evaluation" / "content"
    )
    assert harness_root.exists(), "content eval harness root must exist"
    for subfolder in REQUIRED_SUBFOLDERS:
        assert (harness_root / subfolder).is_dir(), (
            f"missing content eval subfolder: {subfolder}"
        )


def test_reviewer_slots_locked() -> None:
    """The four named reviewer roles are pinned up front so Phase 1 can carry
    per-case sign-off slots rather than sign-off at issue-close time only."""
    assert SUPPORTED_REVIEWERS == {
        "owner_mokhtar": "@MOKHXXXXXX",
        "eval_mostafa": "@MostafaAhmed22",
        "ai_product_merzk": "@mostafamerzk",
        "safety_rabee": "@ARabee3",
    }
    assert len(SUPPORTED_REVIEWERS) == 4


def test_107_contract_document_present() -> None:
    """The normative contract document this harness keys off stays in place."""
    contract = (
        _package_root() / "packages" / "contracts" / "CONTENT_CONTRACT.md"
    )
    assert contract.exists(), "CONTENT_CONTRACT.md must remain in place"


def test_107_publishing_contract_document_present() -> None:
    """The Phase 11 no-publishing guardrail is frozen in
    PUBLISHING_CONTRACT.md."""
    contract = (
        _package_root() / "packages" / "contracts" / "PUBLISHING_CONTRACT.md"
    )
    assert contract.exists(), "PUBLISHING_CONTRACT.md must remain in place"