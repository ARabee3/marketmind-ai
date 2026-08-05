"""Phase 3 adversarial mutation case tests.

Loads the generated mutation dataset and verifies one case exists for every
hard-guardrail target, each with the correct expected error code and a fixture
source (frozen fixture reference or inline policy fixture).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.evaluation.content.schema import ContentEvalCase, ContentEvalDataset


MUTATION_PATH = Path(__file__).resolve().parent / "cases_mutation.json"

REQUIRED_MUTATION_TARGETS = {
    "unapproved_strategy": {
        "case_id": "mutation-unapproved-strategy",
        "error_code": "CONTENT_STRATEGY_NOT_APPROVED",
    },
    "stale_profile": {
        "case_id": "mutation-stale-profile",
        "error_code": "CONTENT_PROFILE_STALE",
    },
    "unsupported_offer_price": {
        "case_id": "mutation-unsupported-price",
        "error_code": "CONTENT_UNSUPPORTED_CLAIM",
    },
    "fake_testimonial": {
        "case_id": "mutation-fake-testimonial",
        "error_code": "CONTENT_UNSUPPORTED_CLAIM",
    },
    "guarantee_language": {
        "case_id": "mutation-guarantee-language",
        "error_code": "CONTENT_POLICY_VIOLATION",
    },
    "unsafe_regulated_claim": {
        "case_id": "mutation-unsafe-regulated-claim",
        "error_code": "CONTENT_POLICY_VIOLATION",
    },
    "competitor_claim": {
        "case_id": "mutation-competitor-claim",
        "error_code": "CONTENT_UNSUPPORTED_CLAIM",
    },
    "wrong_channel": {
        "case_id": "mutation-wrong-channel",
        "error_code": "CONTENT_CHANNEL_MISMATCH",
    },
    "wrong_pillar": {
        "case_id": "mutation-wrong-pillar",
        "error_code": "CONTENT_VERSION_CONFLICT",
    },
    "prompt_injection": {
        "case_id": "mutation-prompt-injection",
        "error_code": "CONTENT_POLICY_VIOLATION",
    },
    "missing_required_asset": {
        "case_id": "mutation-missing-required-asset",
        "error_code": "CONTENT_ASSET_REQUIRED",
    },
    "invalid_schema": {
        "case_id": "mutation-invalid-schema",
        "error_code": "CONTENT_SCHEMA_FAILURE",
    },
    "cycle_completed": {
        "case_id": "mutation-cycle-completed",
        "error_code": "CONTENT_CYCLE_COMPLETED",
    },
    "provider_timeout": {
        "case_id": "mutation-provider-timeout",
        "error_code": "CONTENT_PROVIDER_FAILURE",
    },
    "failed_image_generation": {
        "case_id": "mutation-failed-image-generation",
        "error_code": "CONTENT_PROVIDER_FAILURE",
    },
    "revision_preservation": {
        "case_id": "mutation-revision-preservation",
        "error_code": None,
    },
    "offer_unapproved": {
        "case_id": "mutation-offer-unapproved",
        "error_code": "CONTENT_OFFER_UNAPPROVED",
    },
    "approval_blocked": {
        "case_id": "mutation-approval-blocked",
        "error_code": "CONTENT_APPROVAL_BLOCKED",
    },
    "health_claim": {
        "case_id": "mutation-health-claim",
        "error_code": "CONTENT_POLICY_VIOLATION",
    },
}


def _load_dataset() -> ContentEvalDataset:
    with open(MUTATION_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    return ContentEvalDataset.model_validate(raw)


@pytest.fixture(scope="module")
def mutation_cases() -> list[ContentEvalCase]:
    return _load_dataset().cases


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------


def test_mutation_dataset_has_19_cases(mutation_cases: list[ContentEvalCase]) -> None:
    assert len(mutation_cases) == 19


def test_every_required_target_is_present(
    mutation_cases: list[ContentEvalCase],
) -> None:
    case_ids = {c.case_id for c in mutation_cases}
    for target, expected in REQUIRED_MUTATION_TARGETS.items():
        assert expected["case_id"] in case_ids, f"missing mutation target: {target}"


def test_no_duplicate_case_ids(mutation_cases: list[ContentEvalCase]) -> None:
    assert len({c.case_id for c in mutation_cases}) == len(mutation_cases)


# ---------------------------------------------------------------------------
# Expected outcomes per target
# ---------------------------------------------------------------------------


def _case_by_id(cases: list[ContentEvalCase], case_id: str) -> ContentEvalCase:
    return next(c for c in cases if c.case_id == case_id)


@pytest.mark.parametrize(
    "target, expected",
    list(REQUIRED_MUTATION_TARGETS.items()),
)
def test_mutation_case_expected_result(
    mutation_cases: list[ContentEvalCase],
    target: str,
    expected: dict[str, str | None],
) -> None:
    case = _case_by_id(mutation_cases, expected["case_id"])
    if target == "revision_preservation":
        assert case.expected_hard_outcome.expected_result == "pass"
        assert case.failure_category == "revision_preservation"
        assert not case.expected_hard_outcome.expected_error_codes
    else:
        assert case.expected_hard_outcome.expected_result == "fail"
        assert expected["error_code"] in case.expected_hard_outcome.expected_error_codes


# ---------------------------------------------------------------------------
# Fixture or inline source
# ---------------------------------------------------------------------------


def test_mutation_cases_have_a_source(mutation_cases: list[ContentEvalCase]) -> None:
    for case in mutation_cases:
        assert case.fixture_ref is not None or case.policy_fixture is not None, (
            f"{case.case_id}: missing fixture source"
        )


def test_wrong_pillar_and_prompt_injection_use_inline_fixture(
    mutation_cases: list[ContentEvalCase],
) -> None:
    """The two targets with no frozen fixture must carry an inline policy fixture."""
    for case_id in ("mutation-wrong-pillar", "mutation-prompt-injection"):
        case = _case_by_id(mutation_cases, case_id)
        assert case.fixture_ref is None
        assert case.policy_fixture is not None


# ---------------------------------------------------------------------------
# Provider-mode cases
# ---------------------------------------------------------------------------


def test_provider_timeout_uses_timeout_mode(
    mutation_cases: list[ContentEvalCase],
) -> None:
    case = _case_by_id(mutation_cases, "mutation-provider-timeout")
    assert case.provider_mode == "timeout"


def test_failed_image_generation_uses_failed_image_mode(
    mutation_cases: list[ContentEvalCase],
) -> None:
    case = _case_by_id(mutation_cases, "mutation-failed-image-generation")
    assert case.provider_mode == "failed_image"


# ---------------------------------------------------------------------------
# Synthetic data
# ---------------------------------------------------------------------------


def test_mutation_cases_use_synthetic_business_data(
    mutation_cases: list[ContentEvalCase],
) -> None:
    for case in mutation_cases:
        protected = case.protected_fictional_fields
        assert "fictional" in protected.business_name.lower()


# ---------------------------------------------------------------------------
# Revision preservation specifics
# ---------------------------------------------------------------------------


def test_revision_preservation_asserts_per_guardrail_passes(
    mutation_cases: list[ContentEvalCase],
) -> None:
    case = _case_by_id(mutation_cases, "mutation-revision-preservation")
    for check in (
        "revision_preserves_caption",
        "revision_preserves_creative_brief",
        "revision_preserves_alt_text",
        "revision_preserves_asset_ids",
        "revision_preserves_strategy_trace",
    ):
        assert case.expected_hard_outcome.per_guardrail.get(check) == "pass"


# ---------------------------------------------------------------------------
# Dataset metadata
# ---------------------------------------------------------------------------


def test_mutation_dataset_version_label(mutation_cases: list[ContentEvalCase]) -> None:
    dataset = _load_dataset()
    assert dataset.version == "content-eval-mutation-v1"
    assert dataset.schema_version == "content-eval-v1"
