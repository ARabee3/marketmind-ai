"""Honest, bounded orchestration evaluation and CI smoke reporting."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .contracts import (
    OrchestrationEvaluationCaseV1,
    OrchestrationEvaluationObservationV1,
    OrchestrationEvaluationReportV1,
)


class EvaluationDefinitionError(ValueError):
    """The reviewed case set or observations are malformed."""


def load_evaluation_cases(path: str | Path) -> tuple[OrchestrationEvaluationCaseV1, ...]:
    """Load and validate the reviewed case metadata without outcomes."""

    source = Path(path)
    raw = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise EvaluationDefinitionError("evaluation fixture must contain a JSON array")
    cases = tuple(OrchestrationEvaluationCaseV1.model_validate(item) for item in raw)
    ids = [case.case_id for case in cases]
    if len(set(ids)) != len(ids):
        raise EvaluationDefinitionError("evaluation case IDs must be unique")
    return cases


def build_evaluation_report(
    cases: Iterable[OrchestrationEvaluationCaseV1],
    observations: Iterable[OrchestrationEvaluationObservationV1],
    *,
    suite_version: str = "phase5-smoke-v1",
    generated_at: str | None = None,
) -> OrchestrationEvaluationReportV1:
    """Merge measured observations with explicit ``unmeasured`` case entries."""

    case_list = tuple(cases)
    case_by_id = {case.case_id: case for case in case_list}
    if len(case_by_id) != len(case_list):
        raise EvaluationDefinitionError("evaluation case IDs must be unique")

    observation_by_id: dict[str, OrchestrationEvaluationObservationV1] = {}
    for observation in observations:
        if observation.case_id not in case_by_id:
            raise EvaluationDefinitionError(
                f"observation references unknown case {observation.case_id}"
            )
        if observation.case_id in observation_by_id:
            raise EvaluationDefinitionError(
                f"duplicate observation for case {observation.case_id}"
            )
        observation_by_id[observation.case_id] = observation

    merged: list[OrchestrationEvaluationObservationV1] = []
    for case in case_list:
        merged.append(
            observation_by_id.get(
                case.case_id,
                OrchestrationEvaluationObservationV1(
                    contract_version="orchestration-eval-observation-v1",
                    case_id=case.case_id,
                    measured=False,
                    observed_signal="unmeasured",
                    evidence=[case.measurement_note],
                ),
            )
        )

    measured = [entry for entry in merged if entry.measured]
    passed = [entry for entry in measured if entry.passed is True]
    failed = [entry for entry in measured if entry.passed is False]
    hard_entries = [
        entry for entry in merged if case_by_id[entry.case_id].hard_guardrail
    ]
    if not hard_entries:
        hard_guardrails = "unmeasured"
    elif any(entry.measured and entry.passed is False for entry in hard_entries):
        hard_guardrails = "fail"
    elif all(entry.measured and entry.passed is True for entry in hard_entries):
        hard_guardrails = "pass"
    else:
        hard_guardrails = "unmeasured"

    measured_rate = len(passed) / len(measured) if measured else None
    return OrchestrationEvaluationReportV1(
        contract_version="orchestration-eval-report-v1",
        suite_version=suite_version,
        generated_at=generated_at
        or datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        total_cases=len(merged),
        measured_cases=len(measured),
        passed_cases=len(passed),
        failed_cases=len(failed),
        unmeasured_cases=len(merged) - len(measured),
        measured_pass_rate=measured_rate,
        hard_guardrails=hard_guardrails,
        cases=merged,
    )


CaseRunner = Callable[
    [OrchestrationEvaluationCaseV1],
    OrchestrationEvaluationObservationV1
    | Awaitable[OrchestrationEvaluationObservationV1]
    | None,
]


async def run_evaluation(
    cases: Iterable[OrchestrationEvaluationCaseV1],
    runner: CaseRunner,
    *,
    suite_version: str = "phase5-smoke-v1",
) -> OrchestrationEvaluationReportV1:
    """Run only cases with a supplied adapter and preserve missing evidence."""

    observations: list[OrchestrationEvaluationObservationV1] = []
    for case in cases:
        result = runner(case)
        if result is None:
            continue
        if asyncio.iscoroutine(result) or isinstance(result, Awaitable):
            result = await result
        if result is not None:
            observations.append(result)
    return build_evaluation_report(cases, observations, suite_version=suite_version)


def measured_observation(
    case_id: str,
    *,
    passed: bool,
    observed_signal: str,
    evidence: Iterable[str] = (),
) -> OrchestrationEvaluationObservationV1:
    """Convenience constructor used by smoke adapters and tests."""

    return OrchestrationEvaluationObservationV1(
        contract_version="orchestration-eval-observation-v1",
        case_id=case_id,
        measured=True,
        passed=passed,
        observed_signal=observed_signal,
        evidence=list(evidence)[:10],
    )


def unmeasured_observation(
    case_id: str,
    *,
    observed_signal: str = "unmeasured",
    evidence: Iterable[str] = (),
) -> OrchestrationEvaluationObservationV1:
    """Mark a case explicitly unavailable instead of manufacturing a score."""

    return OrchestrationEvaluationObservationV1(
        contract_version="orchestration-eval-observation-v1",
        case_id=case_id,
        measured=False,
        observed_signal=observed_signal,
        evidence=list(evidence)[:10],
    )
