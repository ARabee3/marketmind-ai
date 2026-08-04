"""Dataset runner, threshold engine, and self-tests (Phase 4/6/8)."""

import sys
from pathlib import Path

# Ensure the frozen contract package is on sys.path when this package is imported
# outside of pytest (e.g. python -m ...runner.real_provider_runner). pytest.ini
# already adds it for the test runs.
_repo_root = Path(__file__).resolve().parents[6]
_contracts_path = _repo_root / "packages" / "contracts" / "python"
if str(_contracts_path) not in sys.path:
    sys.path.insert(0, str(_contracts_path))

from tests.evaluation.content.runner.runner import (
    evaluate_all,
    evaluate_dataset,
    load_all_cases,
    load_dataset,
    run_all,
    run_all_verdict,
    run_cases,
    run_dataset,
)
from tests.evaluation.content.runner.threshold import (
    GUARDRAIL_CHECK_MAP,
    ThresholdConfig,
    ThresholdVerdict,
    evaluate_thresholds,
    format_threshold_summary,
    match_expected_outcome,
    report_threshold_metrics,
)

__all__ = [
    "GUARDRAIL_CHECK_MAP",
    "ThresholdConfig",
    "ThresholdVerdict",
    "evaluate_all",
    "evaluate_dataset",
    "evaluate_thresholds",
    "format_threshold_summary",
    "load_all_cases",
    "load_dataset",
    "match_expected_outcome",
    "report_threshold_metrics",
    "run_all",
    "run_all_verdict",
    "run_cases",
    "run_dataset",
]
