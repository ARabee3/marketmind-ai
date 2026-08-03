"""Machine-readable per-case pass/fail report engine for Content evaluation.

The report never collapses to an aggregate-only green result: every failed case
remains listed with its exact failed-check name and reason, even when the overall
run passes the documented threshold.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tests.evaluation.content.schema import ContentEvalCase
from tests.evaluation.content.validators.common import (
    CaseValidationResult,
    CheckResult,
)


@dataclass
class Report:
    """Machine-readable report for a deterministic validator run."""

    version: str
    run_at: str
    total_cases: int
    cases_checked: int
    cases_passed: int
    cases_failed: int
    cases_with_errors: int
    failed_case_ids: list[str]
    error_case_ids: list[str]
    per_case: list[dict[str, Any]]
    threshold: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "run_at": self.run_at,
            "total_cases": self.total_cases,
            "cases_checked": self.cases_checked,
            "cases_passed": self.cases_passed,
            "cases_failed": self.cases_failed,
            "cases_with_errors": self.cases_with_errors,
            "failed_case_ids": self.failed_case_ids,
            "error_case_ids": self.error_case_ids,
            "per_case": self.per_case,
            "threshold": self.threshold,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)


def build_report(
    case_results: list[tuple[ContentEvalCase, CaseValidationResult]],
    *,
    report_version: str = "content-eval-report-v1",
    threshold: dict[str, Any] | None = None,
) -> Report:
    """Build a report from (case, result) pairs.

    The report always lists per-case results. Aggregate counts are derived only
    for convenience; failed cases are never hidden.
    """
    threshold = threshold or {
        "hard_guardrails_required": 1.0,
        "hard_guardrails_met": None,
        "rubric_required": 0.9,
        "rubric_met": None,
    }

    per_case: list[dict[str, Any]] = []
    cases_passed = 0
    cases_failed = 0
    cases_with_errors = 0
    failed_case_ids: list[str] = []
    error_case_ids: list[str] = []

    for case, result in case_results:
        entry: dict[str, Any] = {
            "case_id": case.case_id,
            "sector": case.sector,
            "language_mode": case.language_mode,
            "failure_category": case.failure_category,
            "expected_result": case.expected_hard_outcome.expected_result,
            "expected_error_codes": case.expected_hard_outcome.expected_error_codes,
            "checked": result.checked,
            "passed": result.passed,
            "error": result.error,
            "failed_checks": [
                check.to_dict() for check in result.failed_checks
            ],
            "all_checks": [check.to_dict() for check in result.checks],
        }
        per_case.append(entry)

        if result.error:
            cases_with_errors += 1
            error_case_ids.append(case.case_id)
        elif result.passed:
            cases_passed += 1
        else:
            cases_failed += 1
            failed_case_ids.append(case.case_id)

    total = len(case_results)
    hard_met = (cases_passed + cases_failed) == total and cases_with_errors == 0
    # Hard guardrails met when every case was checked and there are no errors.
    # Cases that are expected to fail still "pass" the deterministic validator
    # if their actual failure matches expected outcome; here we report raw
    # validator pass/fail. The threshold engine in runner/threshold.py applies
    # expected-outcome matching.
    threshold_out = dict(threshold)
    threshold_out["hard_guardrails_met"] = hard_met

    return Report(
        version=report_version,
        run_at=datetime.now(timezone.utc).isoformat(),
        total_cases=total,
        cases_checked=sum(1 for _, r in case_results if r.checked),
        cases_passed=cases_passed,
        cases_failed=cases_failed,
        cases_with_errors=cases_with_errors,
        failed_case_ids=failed_case_ids,
        error_case_ids=error_case_ids,
        per_case=per_case,
        threshold=threshold_out,
    )


def write_report(report: Report, path: Path) -> Path:
    path.write_text(report.to_json() + "\n", encoding="utf-8")
    return path


def format_human_summary(report: Report) -> str:
    lines = [
        f"Content Evaluation Report ({report.version})",
        f"Run at: {report.run_at}",
        f"Total cases: {report.total_cases}",
        f"Checked: {report.cases_checked}",
        f"Passed: {report.cases_passed}",
        f"Failed: {report.cases_failed}",
        f"Errors: {report.cases_with_errors}",
        "",
        "Failed cases (aggregate never hides individual failures):",
    ]
    if not report.failed_case_ids:
        lines.append("  None")
    else:
        for case_id in report.failed_case_ids:
            entry = next(
                (c for c in report.per_case if c["case_id"] == case_id), None
            )
            if entry:
                names = [c["name"] for c in entry["failed_checks"]]
                lines.append(f"  {case_id}: {', '.join(names)}")
            else:
                lines.append(f"  {case_id}")
    return "\n".join(lines)


def report_case_error(case_id: str, error: str) -> dict[str, Any]:
    """Build a minimal per-case error entry for reports."""
    return {
        "case_id": case_id,
        "checked": False,
        "passed": False,
        "error": error,
        "failed_checks": [],
        "all_checks": [],
    }
