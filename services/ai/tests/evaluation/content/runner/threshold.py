"""Phase 8 threshold engine: expected-outcome matching and documented bars.

The deterministic runner reports raw validator pass/fail per case. This module
applies *expected-outcome matching*: for every case, the actual check results are
compared against the case's ``expected_hard_outcome`` (top-level expected result,
per-guardrail expectations, and expected error codes) so that a case that is
expected to fail still counts as *met* when the right guardrail fires.

Two aggregate bars are then evaluated:

- ``hard_guardrails_met`` — fraction of cases whose expected outcome matched the
  actual validator outcome. Required: ``1.0`` (every case must match).
- ``rubric_met`` — fraction of human rubric dimensions across all cases that are
  actually reviewed (score present with a named reviewer and a timestamp).
  Required: ``0.9``.

The verdict never hides individual cases: every non-matching case is listed with
its reasons, even when the aggregate bars are met.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from tests.evaluation.content.schema import ContentEvalCase, HumanRubric
from tests.evaluation.content.validators.common import CaseValidationResult

# Mapping from per_guardrail guardrail name to the deterministic check name(s)
# that satisfy it. Check names match the validator output exactly, including the
# ``contract:<CODE>`` prefix produced by the frozen contract validator.
GUARDRAIL_CHECK_MAP: dict[str, list[str]] = {
    "strategy_approval": ["contract:CONTENT_STRATEGY_NOT_APPROVED"],
    "profile_version": ["contract:CONTENT_PROFILE_STALE"],
    "unsupported_offer": ["contract:CONTENT_UNSUPPORTED_CLAIM"],
    "unsupported_claim": ["contract:CONTENT_UNSUPPORTED_CLAIM"],
    "guarantee_claim": ["contract:CONTENT_POLICY_VIOLATION"],
    "regulated_claim": ["contract:CONTENT_POLICY_VIOLATION"],
    "competitor_claim": ["contract:CONTENT_UNSUPPORTED_CLAIM"],
    "selected_channel": ["contract:CONTENT_CHANNEL_MISMATCH"],
    "pillar_alignment": ["wrong_pillar"],
    "prompt_injection": ["prompt_injection"],
    "required_asset": ["contract:CONTENT_ASSET_REQUIRED"],
    "schema_validity": ["contract:CONTENT_SCHEMA_FAILURE"],
    "provider_timeout": ["provider_timeout", "contract:CONTENT_PROVIDER_FAILURE"],
    "asset_generation": ["asset_generation", "contract:CONTENT_PROVIDER_FAILURE"],
    "revision_preserves_caption": ["revision_preserves_caption"],
    "revision_preserves_creative_brief": ["revision_preserves_creative_brief"],
    "revision_preserves_alt_text": ["revision_preserves_alt_text"],
    "revision_preserves_asset_ids": ["revision_preserves_asset_ids"],
    "revision_preserves_strategy_trace": ["revision_preserves_strategy_trace"],
    "item_count": ["provider_item_count"],
    "atomic_weekly_claim": ["contract:CONTENT_WEEK_ALREADY_CLAIMED"],
    "cycle_status": ["contract:CONTENT_CYCLE_PAUSED"],
    "cycle_completed": ["contract:CONTENT_CYCLE_COMPLETED"],
    "week_in_range": ["week_in_range"],
    "week_12_completion": ["week_12_completion"],
    # Positive-only guardrails have no dedicated failure check; a case is met
    # when the relevant contract gate did not fire.
    "consecutive_week": [],
    "safe_default_context": [],
    "asset_ready": [],
    "channel_match": [],
    "offer_approved": [],
    "offer_unapproved": ["contract:CONTENT_OFFER_UNAPPROVED"],
    "approval_blocked": ["contract:CONTENT_APPROVAL_BLOCKED"],
    # Advisory-only guardrail: never a hard blocker; passes whenever present.
    "funnel_mix": [],
}

RUBRIC_DIMENSIONS = (
    "language",
    "tone",
    "usefulness",
    "pillar_alignment",
    "cta",
    "dialect",
)

DEFAULT_HARD_GUARDRAILS_REQUIRED = 1.0
DEFAULT_RUBRIC_REQUIRED = 0.9


@dataclass(frozen=True)
class ThresholdConfig:
    """Documented threshold bars."""

    hard_guardrails_required: float = DEFAULT_HARD_GUARDRAILS_REQUIRED
    rubric_required: float = DEFAULT_RUBRIC_REQUIRED


@dataclass
class ExpectedOutcomeMatch:
    """Result of matching one case's actual validator outcome to its expectation."""

    case_id: str
    expected_result: str
    matched: bool
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "expected_result": self.expected_result,
            "matched": self.matched,
            "reasons": self.reasons,
        }


@dataclass
class ThresholdVerdict:
    """Aggregate threshold evaluation across a case run."""

    generated_at: str
    total_cases: int
    hard_guardrails_required: float
    hard_guardrails_met: float
    hard_guardrails_passed: bool
    rubric_required: float
    rubric_met: float
    rubric_passed: bool
    passed: bool
    matches: list[ExpectedOutcomeMatch]

    @property
    def unmet_case_ids(self) -> list[str]:
        return [m.case_id for m in self.matches if not m.matched]

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "total_cases": self.total_cases,
            "hard_guardrails_required": self.hard_guardrails_required,
            "hard_guardrails_met": self.hard_guardrails_met,
            "hard_guardrails_passed": self.hard_guardrails_passed,
            "rubric_required": self.rubric_required,
            "rubric_met": self.rubric_met,
            "rubric_passed": self.rubric_passed,
            "passed": self.passed,
            "unmet_case_ids": self.unmet_case_ids,
            "matches": [m.to_dict() for m in self.matches],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)


def _check_status(result: CaseValidationResult) -> dict[str, bool]:
    """Map check name -> passed status from a validation result."""
    if result.error:
        return {}
    return {check.name: check.passed for check in result.checks}


def _guardrail_met(
    guardrail: str,
    expected: str,
    status: dict[str, bool],
) -> tuple[bool, str]:
    """Verify one guardrail expectation against actual check status.

    Expected ``pass`` is met when none of the mapped checks are present in a
    failed state (the check may be absent when the case does not exercise it).
    Expected ``fail`` is met only when at least one mapped check actually fired.
    """
    targets = GUARDRAIL_CHECK_MAP.get(guardrail, [])
    failed = [t for t in targets if t in status and not status[t]]
    if expected == "pass":
        if failed:
            return False, f"guardrail '{guardrail}' expected pass but {failed} fired"
        return True, f"guardrail '{guardrail}' satisfied (pass)"
    if not failed:
        return False, f"guardrail '{guardrail}' expected fail but none of {targets} fired"
    return True, f"guardrail '{guardrail}' satisfied (fail via {failed})"


def match_expected_outcome(
    case: ContentEvalCase,
    result: CaseValidationResult,
) -> ExpectedOutcomeMatch:
    """Compare a case's actual validator outcome against its expected outcome."""
    expected = case.expected_hard_outcome.expected_result
    reasons: list[str] = []

    if result.error:
        reasons.append(f"case evaluation errored: {result.error}")
        return ExpectedOutcomeMatch(
            case_id=case.case_id,
            expected_result=expected,
            matched=False,
            reasons=reasons,
        )

    status = _check_status(result)

    per_guardrail = case.expected_hard_outcome.per_guardrail
    if per_guardrail:
        ok = True
        for guardrail, exp in per_guardrail.items():
            met, reason = _guardrail_met(guardrail, exp, status)
            if not met:
                ok = False
            reasons.append(reason)
        if ok:
            return ExpectedOutcomeMatch(
                case_id=case.case_id,
                expected_result=expected,
                matched=True,
                reasons=reasons,
            )
        return ExpectedOutcomeMatch(
            case_id=case.case_id,
            expected_result=expected,
            matched=False,
            reasons=reasons,
        )

    # No per-guardrail detail: fall back to the top-level expected result.
    actual_passed = result.passed
    if (expected == "pass") == actual_passed:
        reasons.append(
            f"top-level expected {expected} and validator "
            f"{'passed' if actual_passed else 'failed'}"
        )
        return ExpectedOutcomeMatch(
            case_id=case.case_id,
            expected_result=expected,
            matched=True,
            reasons=reasons,
        )
    reasons.append(
        f"top-level expected {expected} but validator "
        f"{'passed' if actual_passed else 'failed'}"
    )
    return ExpectedOutcomeMatch(
        case_id=case.case_id,
        expected_result=expected,
        matched=False,
        reasons=reasons,
    )


def _rubric_covered(case: ContentEvalCase) -> tuple[int, int]:
    """Return (covered, applicable) rubric dimensions for a case.

    A rubric dimension only *applies* where content was actually produced for a
    human to score. Cases rejected by a hard guardrail before any content exists
    carry an N/A rubric (score 0 with ``Rubric N/A`` notes) and are excluded from
    both the numerator and the denominator.

    An applicable dimension is ``covered`` only when the AI/product reviewer
    (@mostafamerzk) has actually signed off on the case.  Generator-authored
    placeholder scores with a timestamp do not count — the reviewer must have
    explicitly signed the case via the ``reviewers.ai_product_merzk.signed_off``
    flag.
    """
    if not case.reviewers.ai_product_merzk.signed_off:
        rubric: HumanRubric = case.human_rubric
        applicable = [
            d
            for d in (
                rubric.language,
                rubric.tone,
                rubric.usefulness,
                rubric.pillar_alignment,
                rubric.cta,
                rubric.dialect,
            )
            if not (d.score == 0 and d.notes.lstrip().startswith("Rubric N/A"))
        ]
        return 0, len(applicable)

    rubric: HumanRubric = case.human_rubric
    dims = [
        rubric.language,
        rubric.tone,
        rubric.usefulness,
        rubric.pillar_alignment,
        rubric.cta,
        rubric.dialect,
    ]
    applicable = [
        d
        for d in dims
        if not (d.score == 0 and d.notes.lstrip().startswith("Rubric N/A"))
    ]
    covered = sum(
        1
        for d in applicable
        if d.score > 0 and d.reviewer_handle and d.reviewed_at
    )
    return covered, len(applicable)


def evaluate_thresholds(
    case_results: list[tuple[ContentEvalCase, CaseValidationResult]],
    *,
    config: ThresholdConfig | None = None,
) -> ThresholdVerdict:
    """Evaluate the documented threshold bars over a full case run."""
    config = config or ThresholdConfig()

    matches = [match_expected_outcome(case, result) for case, result in case_results]
    matched_count = sum(1 for m in matches if m.matched)
    total = len(case_results)
    hard_met = (matched_count / total) if total else 0.0

    rubric_covered = sum(_rubric_covered(case)[0] for case, _ in case_results)
    rubric_total = sum(_rubric_covered(case)[1] for case, _ in case_results)
    rubric_met = (rubric_covered / rubric_total) if rubric_total else 0.0

    hard_passed = hard_met >= config.hard_guardrails_required
    rubric_passed = rubric_met >= config.rubric_required

    return ThresholdVerdict(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total_cases=total,
        hard_guardrails_required=config.hard_guardrails_required,
        hard_guardrails_met=round(hard_met, 4),
        hard_guardrails_passed=hard_passed,
        rubric_required=config.rubric_required,
        rubric_met=round(rubric_met, 4),
        rubric_passed=rubric_passed,
        passed=hard_passed and rubric_passed,
        matches=matches,
    )


def format_threshold_summary(verdict: ThresholdVerdict) -> str:
    """Human-readable summary of the threshold verdict."""
    lines = [
        f"Threshold Verdict ({verdict.generated_at})",
        f"Passed: {verdict.passed}",
        f"Hard guardrails: {verdict.hard_guardrails_met:.2%} "
        f"(required {verdict.hard_guardrails_required:.0%}) -> "
        f"{'PASS' if verdict.hard_guardrails_passed else 'FAIL'}",
        f"Rubric review: {verdict.rubric_met:.2%} "
        f"(required {verdict.rubric_required:.0%}) -> "
        f"{'PASS' if verdict.rubric_passed else 'FAIL'}",
        "",
        "Unmet cases (never hidden by aggregate bars):",
    ]
    unmet = verdict.unmet_case_ids
    if not unmet:
        lines.append("  None")
    else:
        for match in verdict.matches:
            if not match.matched:
                lines.append(f"  {match.case_id}")
                for reason in match.reasons:
                    lines.append(f"      - {reason}")
    return "\n".join(lines)


def report_threshold_metrics(
    verdict: ThresholdVerdict,
) -> dict[str, Any]:
    """Compact threshold dict for embedding into the run report."""
    return {
        "hard_guardrails_required": verdict.hard_guardrails_required,
        "hard_guardrails_met": verdict.hard_guardrails_met,
        "hard_guardrails_passed": verdict.hard_guardrails_passed,
        "rubric_required": verdict.rubric_required,
        "rubric_met": verdict.rubric_met,
        "rubric_passed": verdict.rubric_passed,
        "threshold_passed": verdict.passed,
        "unmet_case_ids": verdict.unmet_case_ids,
    }


if __name__ == "__main__":
    import sys

    from tests.evaluation.content.runner.runner import load_all_cases, run_cases

    verdict = evaluate_thresholds(run_cases(load_all_cases()))
    print(format_threshold_summary(verdict))
    if not verdict.passed:
        sys.exit(1)
