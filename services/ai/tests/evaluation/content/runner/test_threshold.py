"""Phase 8 threshold engine tests.

Verifies expected-outcome matching against the real generated datasets and the
documented threshold bars (hard guardrails 1.0, rubric 0.9).
"""

from __future__ import annotations

from tests.evaluation.content.runner.runner import load_all_cases, run_cases
from tests.evaluation.content.runner.threshold import (
    GUARDRAIL_CHECK_MAP,
    ExpectedOutcomeMatch,
    ThresholdConfig,
    evaluate_thresholds,
    format_threshold_summary,
    match_expected_outcome,
    report_threshold_metrics,
)
from tests.evaluation.content.validators.content_validator import validate_case


def _real_results():
    return run_cases(load_all_cases())


def test_guardrail_map_covers_all_dataset_guardrails() -> None:
    """Every per_guardrail key used in the datasets must have a mapping."""
    used = {
        guardrail
        for case in load_all_cases()
        for guardrail in case.expected_hard_outcome.per_guardrail
    }
    missing = used - set(GUARDRAIL_CHECK_MAP)
    assert not missing, f"unmapped guardrails: {missing}"


def test_all_34_cases_hard_guardrails_match_expected_outcome() -> None:
    """Hard guardrails 100% irrespective of rubric sign-off state."""
    verdict = evaluate_thresholds(
        _real_results(),
        config=ThresholdConfig(hard_guardrails_required=1.0, rubric_required=0.0),
    )
    assert verdict.total_cases == 34
    assert verdict.hard_guardrails_met == 1.0
    assert verdict.hard_guardrails_passed is True
    assert verdict.unmet_case_ids == []


def test_provider_timeout_counts_as_met() -> None:
    """provider-timeout expects fail at top level but the timeout guardrail is
    correctly surfaced (pass) — expected-outcome matching must accept this."""
    case = next(c for c in load_all_cases() if c.case_id == "mutation-provider-timeout")
    match = match_expected_outcome(case, validate_case(case))
    assert match.matched is True
    assert any("provider_timeout" in r for r in match.reasons)


def test_revision_preservation_counts_as_met() -> None:
    case = next(c for c in load_all_cases() if c.case_id == "mutation-revision-preservation")
    match = match_expected_outcome(case, validate_case(case))
    assert match.matched is True
    assert all(
        "revision_preserves" in r for r in match.reasons if "satisfied" in r
    )


def test_expected_fail_case_with_wrong_check_is_unmet() -> None:
    """A guardrail expected to fail but not actually firing must be unmet."""
    case = next(c for c in load_all_cases() if c.case_id == "mutation-unapproved-strategy")
    from tests.evaluation.content.validators.common import (
        CaseValidationResult,
        CheckResult,
    )

    fake_result = CaseValidationResult(
        case_id=case.case_id,
        checked=True,
        checks=[CheckResult("prompt_injection", True), CheckResult("no_publishing_guardrail", True)],
    )
    match = match_expected_outcome(case, fake_result)
    assert match.matched is False
    assert any("strategy_approval" in r for r in match.reasons)


def test_expected_pass_case_with_fired_check_is_unmet() -> None:
    """A guardrail expected to pass but firing must be unmet."""
    case = next(c for c in load_all_cases() if c.case_id == "hospitality-en-week1-baseline")
    from tests.evaluation.content.validators.common import (
        CaseValidationResult,
        CheckResult,
    )

    fake_result = CaseValidationResult(
        case_id=case.case_id,
        checked=True,
        checks=[CheckResult("contract:CONTENT_STRATEGY_NOT_APPROVED", False)],
    )
    match = match_expected_outcome(case, fake_result)
    assert match.matched is False
    assert any("strategy_approval" in r for r in match.reasons)


def test_error_case_is_unmet() -> None:
    case = next(c for c in load_all_cases() if c.case_id == "hospitality-en-week1-baseline")
    from tests.evaluation.content.validators.common import CaseValidationResult

    fake_result = CaseValidationResult(
        case_id=case.case_id,
        checked=False,
        checks=[],
        error="boom",
    )
    match = match_expected_outcome(case, fake_result)
    assert match.matched is False
    assert any("errored" in r for r in match.reasons)


def test_rubric_met_zero_when_no_reviewer_signed_off() -> None:
    """Rubric dimensions require ai_product_merzk.signed_off — placeholder scores don't count."""
    verdict = evaluate_thresholds(
        _real_results(),
        config=ThresholdConfig(hard_guardrails_required=0.0, rubric_required=0.9),
    )
    assert verdict.rubric_met == 0.0
    assert verdict.rubric_passed is False
    assert verdict.passed is False


def test_rubric_passes_when_signed_off() -> None:
    """Individual case with signed-off reviewer counts rubric as reviewed."""
    from tests.evaluation.content.validators.common import (
        CaseValidationResult,
        CheckResult,
    )

    cases = load_all_cases()
    c = next(x for x in cases if x.case_id == "hospitality-en-week1-baseline")
    updated_reviewers = c.reviewers.model_copy(
        update={
            "ai_product_merzk": c.reviewers.ai_product_merzk.model_copy(
                update={"signed_off": True, "signed_at": "2026-08-03"}
            ),
            "owner_mokhtar": c.reviewers.owner_mokhtar.model_copy(
                update={"signed_off": True, "signed_at": "2026-08-03"}
            ),
            "eval_mostafa": c.reviewers.eval_mostafa.model_copy(
                update={"signed_off": True, "signed_at": "2026-08-03"}
            ),
            "safety_rabee": c.reviewers.safety_rabee.model_copy(
                update={"signed_off": True, "signed_at": "2026-08-03"}
            ),
        }
    )
    signed = c.model_copy(update={"reviewers": updated_reviewers})

    fake_result = CaseValidationResult(
        case_id=signed.case_id,
        checked=True,
        checks=[CheckResult("contract_policy", True)],
    )
    verdict = evaluate_thresholds(
        [(signed, fake_result)],
        config=ThresholdConfig(hard_guardrails_required=0.0, rubric_required=0.5),
    )
    assert verdict.rubric_met == 1.0
    assert verdict.rubric_passed is True


def test_threshold_config_bars_default() -> None:
    config = ThresholdConfig()
    assert config.hard_guardrails_required == 1.0
    assert config.rubric_required == 0.9


def test_verdict_to_dict_and_metrics_round_trip() -> None:
    verdict = evaluate_thresholds(
        _real_results(),
        config=ThresholdConfig(hard_guardrails_required=1.0, rubric_required=0.0),
    )
    data = verdict.to_dict()
    assert data["passed"] is True
    assert data["total_cases"] == 34
    metrics = report_threshold_metrics(verdict)
    assert metrics["threshold_passed"] is True
    assert metrics["unmet_case_ids"] == []


def test_format_summary_lists_none_when_all_met() -> None:
    verdict = evaluate_thresholds(
        _real_results(),
        config=ThresholdConfig(hard_guardrails_required=1.0, rubric_required=0.0),
    )
    summary = format_threshold_summary(verdict)
    assert "PASS" in summary
    assert "None" in summary


def test_summary_lists_unmet_cases_with_reasons() -> None:
    """Aggregate bars never hide individual unmet cases."""
    case = next(c for c in load_all_cases() if c.case_id == "mutation-unapproved-strategy")
    from tests.evaluation.content.validators.common import (
        CaseValidationResult,
        CheckResult,
    )

    fake_result = CaseValidationResult(
        case_id=case.case_id,
        checked=True,
        checks=[CheckResult("no_publishing_guardrail", True)],
    )
    verdict = evaluate_thresholds(
        [(case, fake_result)],
        config=ThresholdConfig(rubric_required=0.0),
    )
    assert verdict.passed is False
    summary = format_threshold_summary(verdict)
    assert "mutation-unapproved-strategy" in summary
    assert "strategy_approval" in summary
