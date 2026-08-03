"""Content eval dataset runner.

Loads one or more case datasets, runs the deterministic validators (including the
Phase 5 fake-provider checks), and builds a machine-readable report.  No paid
LLM or network-backed provider is used: the only provider calls are to the
local, deterministic ``FakeContentProvider`` modes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tests.evaluation.content.schema import ContentEvalCase, ContentEvalDataset
from tests.evaluation.content.validators.common import CaseValidationResult
from tests.evaluation.content.validators.content_validator import validate_case
from tests.evaluation.content.reports.report import Report, build_report
from tests.evaluation.content.runner.threshold import (
    ThresholdConfig,
    ThresholdVerdict,
    evaluate_thresholds,
    report_threshold_metrics,
)


DEFAULT_CASES_DIR = Path(__file__).resolve().parent.parent / "cases"


def load_dataset(path: Path) -> ContentEvalDataset:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return ContentEvalDataset.model_validate(raw)


def load_all_cases(cases_dir: Path | None = None) -> list[ContentEvalCase]:
    cases_dir = cases_dir or DEFAULT_CASES_DIR
    cases: list[ContentEvalCase] = []
    for path in sorted(cases_dir.glob("cases_*.json")):
        cases.extend(load_dataset(path).cases)
    return cases


def run_cases(cases: list[ContentEvalCase]) -> list[tuple[ContentEvalCase, CaseValidationResult]]:
    """Run deterministic validators against every case."""
    return [(case, validate_case(case)) for case in cases]


def _apply_threshold(
    report: Report,
    results: list[tuple[ContentEvalCase, CaseValidationResult]],
    config: ThresholdConfig | None,
) -> Report:
    """Merge Phase 8 threshold verdict metrics into the report's threshold dict."""
    verdict = evaluate_thresholds(results, config=config or ThresholdConfig())
    report.threshold.update(report_threshold_metrics(verdict))
    return report


def run_dataset(path: Path, config: ThresholdConfig | None = None) -> Report:
    dataset = load_dataset(path)
    results = run_cases(dataset.cases)
    return _apply_threshold(build_report(results), results, config)


def run_all(
    cases_dir: Path | None = None,
    config: ThresholdConfig | None = None,
) -> Report:
    cases = load_all_cases(cases_dir)
    results = run_cases(cases)
    return _apply_threshold(build_report(results), results, config)


def evaluate_dataset(path: Path, config: ThresholdConfig | None = None) -> dict[str, Any]:
    """Convenience entry point returning the report as a dict."""
    return run_dataset(path, config).to_dict()


def evaluate_all(
    cases_dir: Path | None = None,
    config: ThresholdConfig | None = None,
) -> dict[str, Any]:
    """Convenience entry point returning the full report as a dict."""
    return run_all(cases_dir, config).to_dict()


def run_all_verdict(
    cases_dir: Path | None = None,
    config: ThresholdConfig | None = None,
) -> ThresholdVerdict:
    """Run every case and return the Phase 8 threshold verdict directly."""
    cases = load_all_cases(cases_dir)
    results = run_cases(cases)
    return evaluate_thresholds(results, config=config or ThresholdConfig())
