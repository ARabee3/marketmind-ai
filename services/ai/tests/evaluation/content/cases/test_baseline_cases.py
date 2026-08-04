"""Phase 2 baseline coverage matrix tests.

Loads the generated per-sector baseline case files and verifies the matrix
requirements: ≥15 cases, ≥3 per sector, language modes distributed across
sectors (not clustered), synthetic fictional data only, and every required
rolling-cycle scenario represented.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.evaluation.content.schema import (
    ContentEvalCase,
    ContentEvalDataset,
    Sector,
)


CASES_DIR = Path(__file__).resolve().parent


REQUIRED_SECTORS = {
    "hospitality",
    "retail",
    "services",
    "education",
    "healthcare",
}

REQUIRED_LANGUAGE_MODES = {"ar", "en", "mixed"}

REQUIRED_ROLLING_SCENARIOS = {
    "consecutive_week": {
        "hospitality-ar-week2-consecutive",
        "services-ar-week4-consecutive",
        "healthcare-mixed-week11-consecutive",
    },
    "safe_default_context": {
        "retail-en-week3-safe-default",
        "education-ar-week5-safe-default",
    },
    "duplicate_trigger_collision": {
        "services-en-week2-duplicate-claim",
    },
    "stale_superseded_cycle": {
        "education-mixed-superseded-cycle",
    },
    "week_12_clean_completion": {
        "hospitality-mixed-week12-completion",
        "healthcare-en-week12-completion",
    },
    "week_13_hard_rejection": {
        "retail-mixed-week13-rejection",
    },
}


def _load_dataset(path: Path) -> ContentEvalDataset:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return ContentEvalDataset.model_validate(raw)


@pytest.fixture(scope="module")
def baseline_cases() -> list[ContentEvalCase]:
    cases: list[ContentEvalCase] = []
    for path in sorted(CASES_DIR.glob("cases_baseline_*.json")):
        cases.extend(_load_dataset(path).cases)
    return cases


# ---------------------------------------------------------------------------
# Coverage matrix
# ---------------------------------------------------------------------------


def test_at_least_15_baseline_cases(baseline_cases: list[ContentEvalCase]) -> None:
    assert len(baseline_cases) >= 15


def test_exactly_three_cases_per_sector(baseline_cases: list[ContentEvalCase]) -> None:
    for sector in REQUIRED_SECTORS:
        sector_cases = [c for c in baseline_cases if c.sector == sector]
        assert len(sector_cases) == 3, (
            f"sector {sector} should have 3 cases, got {len(sector_cases)}"
        )


def test_all_five_sectors_present(baseline_cases: list[ContentEvalCase]) -> None:
    sectors = {c.sector for c in baseline_cases}
    assert sectors == REQUIRED_SECTORS


def test_language_modes_distributed_per_sector(
    baseline_cases: list[ContentEvalCase],
) -> None:
    """Each sector has one ar, one en, and one mixed case."""
    for sector in REQUIRED_SECTORS:
        modes = {c.language_mode for c in baseline_cases if c.sector == sector}
        assert modes == REQUIRED_LANGUAGE_MODES, (
            f"sector {sector} missing language modes: {modes}"
        )


def test_language_modes_not_clustered_in_one_sector(
    baseline_cases: list[ContentEvalCase],
) -> None:
    """Every language mode appears in multiple sectors, not just one."""
    for mode in REQUIRED_LANGUAGE_MODES:
        sectors = {c.sector for c in baseline_cases if c.language_mode == mode}
        assert len(sectors) >= 3, (
            f"language mode {mode} appears in only {len(sectors)} sector(s): {sectors}"
        )


# ---------------------------------------------------------------------------
# Synthetic / fictional data only
# ---------------------------------------------------------------------------


def test_no_real_business_or_competitor_names(baseline_cases: list[ContentEvalCase]) -> None:
    """Spot-check that protected fictional fields are clearly synthetic."""
    for case in baseline_cases:
        protected = case.protected_fictional_fields
        assert "fictional" in protected.business_name.lower() or "fictional" in (
            protected.owner_text.lower()
        ), (
            f"{case.case_id}: business data does not look synthetic"
        )


def test_owner_handles_are_fictional(baseline_cases: list[ContentEvalCase]) -> None:
    for case in baseline_cases:
        for handle in case.protected_fictional_fields.handles:
            assert handle.startswith("@"), f"{case.case_id}: invalid handle {handle}"
            assert "fictional" in handle.lower() or "demo" in handle.lower(), (
                f"{case.case_id}: handle {handle} does not look synthetic"
            )


# ---------------------------------------------------------------------------
# Rolling-cycle scenario coverage
# ---------------------------------------------------------------------------


def test_required_rolling_cycle_scenarios_present(
    baseline_cases: list[ContentEvalCase],
) -> None:
    case_ids = {c.case_id for c in baseline_cases}
    for scenario, expected_ids in REQUIRED_ROLLING_SCENARIOS.items():
        assert expected_ids.issubset(case_ids), (
            f"missing {scenario} scenario cases: {expected_ids - case_ids}"
        )


def test_consecutive_week_cases_have_prior_pack(
    baseline_cases: list[ContentEvalCase]) -> None:
    for case_id in REQUIRED_ROLLING_SCENARIOS["consecutive_week"]:
        case = next(c for c in baseline_cases if c.case_id == case_id)
        assert case.cycle_state.prior_content_pack_id is not None
        assert case.cycle_state.week_number > 1


def test_safe_default_cases_have_absent_next_context(
    baseline_cases: list[ContentEvalCase],
) -> None:
    for case_id in REQUIRED_ROLLING_SCENARIOS["safe_default_context"]:
        case = next(c for c in baseline_cases if c.case_id == case_id)
        assert case.cycle_state.next_week_context is None
        assert case.cycle_state.next_week_context_absent is True


def test_duplicate_collision_case_is_expected_failure(
    baseline_cases: list[ContentEvalCase],
) -> None:
    case = next(
        c
        for c in baseline_cases
        if c.case_id in REQUIRED_ROLLING_SCENARIOS["duplicate_trigger_collision"]
    )
    assert case.expected_hard_outcome.expected_result == "fail"
    assert "CONTENT_WEEK_ALREADY_CLAIMED" in case.expected_hard_outcome.expected_error_codes


def test_superseded_cycle_case_is_expected_failure(
    baseline_cases: list[ContentEvalCase],
) -> None:
    case = next(
        c
        for c in baseline_cases
        if c.case_id in REQUIRED_ROLLING_SCENARIOS["stale_superseded_cycle"]
    )
    assert case.expected_hard_outcome.expected_result == "fail"
    assert case.failure_category == "cycle_paused"


def test_week_12_completion_cases_are_expected_passes(
    baseline_cases: list[ContentEvalCase],
) -> None:
    for case_id in REQUIRED_ROLLING_SCENARIOS["week_12_clean_completion"]:
        case = next(c for c in baseline_cases if c.case_id == case_id)
        assert case.cycle_state.week_number == 12
        assert case.expected_hard_outcome.expected_result == "pass"


def test_week_13_rejection_case_is_expected_failure(
    baseline_cases: list[ContentEvalCase],
) -> None:
    case = next(
        c
        for c in baseline_cases
        if c.case_id in REQUIRED_ROLLING_SCENARIOS["week_13_hard_rejection"]
    )
    assert case.cycle_state.week_number == 13
    assert case.expected_hard_outcome.expected_result == "fail"
    assert "CONTENT_WEEK_OUT_OF_RANGE" in case.expected_hard_outcome.expected_error_codes


# ---------------------------------------------------------------------------
# Schema-level sanity
# ---------------------------------------------------------------------------


def test_all_cases_have_fixture_ref_or_policy_fixture(
    baseline_cases: list[ContentEvalCase],
) -> None:
    for case in baseline_cases:
        assert case.fixture_ref is not None or case.policy_fixture is not None


def test_all_cases_use_content_eval_v1_schema(baseline_cases: list[ContentEvalCase]) -> None:
    for case in baseline_cases:
        assert case.schema_version == "content-eval-v1"


def test_dataset_version_matches_baseline_label(baseline_cases: list[ContentEvalCase]) -> None:
    for path in sorted(CASES_DIR.glob("cases_baseline_*.json")):
        dataset = _load_dataset(path)
        assert dataset.version == "content-eval-baseline-v1"
        assert dataset.schema_version == "content-eval-v1"


# ---------------------------------------------------------------------------
# Failure/pass balance in baseline
# ---------------------------------------------------------------------------


def test_baseline_contains_both_passes_and_failures(
    baseline_cases: list[ContentEvalCase],
) -> None:
    results = {c.expected_hard_outcome.expected_result for c in baseline_cases}
    assert "pass" in results
    assert "fail" in results


def test_failure_cases_have_expected_error_codes(
    baseline_cases: list[ContentEvalCase],
) -> None:
    for case in baseline_cases:
        if case.expected_hard_outcome.expected_result == "fail":
            assert case.expected_hard_outcome.expected_error_codes
            assert case.failure_category != "no_failure"


def test_passing_cases_have_no_failure_category(
    baseline_cases: list[ContentEvalCase]) -> None:
    for case in baseline_cases:
        if case.expected_hard_outcome.expected_result == "pass":
            assert case.failure_category == "no_failure"
            assert not case.expected_hard_outcome.expected_error_codes


# ---------------------------------------------------------------------------
# Reviewer slots
# ---------------------------------------------------------------------------


def test_all_cases_have_four_reviewer_slots(baseline_cases: list[ContentEvalCase]) -> None:
    for case in baseline_cases:
        assert case.reviewers.owner_mokhtar.handle == "@MOKHXXXXXX"
        assert case.reviewers.eval_mostafa.handle == "@MostafaAhmed22"
        assert case.reviewers.ai_product_merzk.handle == "@mostafamerzk"
        assert case.reviewers.safety_rabee.handle == "@ARabee3"


def test_no_baseline_case_is_final(baseline_cases: list[ContentEvalCase]) -> None:
    """Baseline cases are authored but not yet human-reviewed."""
    for case in baseline_cases:
        assert case.is_final is False
