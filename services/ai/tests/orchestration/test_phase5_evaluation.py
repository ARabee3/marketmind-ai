from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.orchestration.phase5 import (
    EvaluationDefinitionError,
    InMemoryTraceSink,
    NonBlockingTraceSink,
    OrchestrationEvaluationObservationV1,
    ShadowPathSummaryV1,
    build_evaluation_report,
    compare_shadow_paths,
    decide_rollout,
    load_evaluation_cases,
    make_trace_event,
    measured_observation,
    publication_actions,
    run_evaluation,
    sanitize_trace_payload,
)


FIXTURE = Path(__file__).parent / "fixtures" / "phase5_smoke_cases.json"
RUN_ID = "11111111-1111-4111-8111-111111111111"


def _trace_event():
    now = datetime(2026, 8, 7, 8, 0, tzinfo=UTC)
    return make_trace_event(
        trace_id=RUN_ID,
        span_id="phase5-smoke-span",
        run_id=RUN_ID,
        correlation_id="phase5-smoke",
        environment="test",
        feature_cohort="phase5-tests",
        graph_name="campaign-v1",
        graph_version="2026-08-07",
        event_type="terminal",
        status="completed",
        started_at=now,
        finished_at=now,
        summary="Publishing remains outside the orchestration graph.",
        details={"action": "owner_decision"},
    )


def test_reviewed_phase5_fixture_has_no_outcomes_or_duplicate_ids():
    cases = load_evaluation_cases(FIXTURE)

    assert len(cases) == 10
    assert len({case.case_id for case in cases}) == len(cases)
    assert all(case.expected_signal for case in cases)
    assert sum(case.hard_guardrail for case in cases) == 9


@pytest.mark.asyncio
async def test_smoke_report_keeps_unmeasured_cases_visible():
    cases = load_evaluation_cases(FIXTURE)

    async def runner(case):
        if not case.smoke_supported:
            return None
        if case.case_id == "trace-redaction":
            safe = sanitize_trace_payload(
                {
                    "system_prompt": "private",
                    "owner_email": "owner@example.test",
                    "tool_calls": 2,
                }
            )
            passed = (
                safe["system_prompt"] == "[REDACTED]"
                and safe["owner_email"] == "[REDACTED]"
                and safe["tool_calls"] == 2
            )
            evidence = ["private fields redacted; operational count retained"]
        elif case.case_id == "trace-outage":
            class FailingExporter:
                async def export(self, event):
                    raise RuntimeError("injected outage")

            sink = NonBlockingTraceSink(InMemoryTraceSink(), FailingExporter())
            await sink.emit(_trace_event())
            await sink.flush()
            snapshot = sink.snapshot(trace_id=RUN_ID, run_id=RUN_ID)
            passed = snapshot.event_count == 1 and snapshot.degraded_export
            evidence = ["local event retained; degraded exporter state recorded"]
        elif case.case_id == "disabled-by-default":
            decision = decide_rollout(
                orchestration_enabled=False,
                feature_cohort="demo-only",
                allowed_cohorts=["demo-only"],
            )
            passed = decision.enabled is False and decision.mode == "disabled"
            evidence = ["current path remains authoritative"]
        elif case.case_id == "no-publication-action":
            passed = not publication_actions([_trace_event()])
            evidence = ["explanatory publishing text produced no explicit action"]
        else:
            return None
        return measured_observation(
            case.case_id,
            passed=passed,
            observed_signal=case.expected_signal,
            evidence=evidence,
        )

    report = await run_evaluation(cases, runner)

    assert report.total_cases == 10
    assert report.measured_cases == 4
    assert report.passed_cases == 4
    assert report.failed_cases == 0
    assert report.unmeasured_cases == 6
    assert report.measured_pass_rate == 1
    assert report.hard_guardrails == "unmeasured"
    assert sum(not case.measured for case in report.cases) == 6


def test_hard_guardrail_failure_is_not_hidden_by_other_passes():
    cases = load_evaluation_cases(FIXTURE)[:2]
    report = build_evaluation_report(
        cases,
        [
            measured_observation(
                "trace-redaction",
                passed=True,
                observed_signal="redacted",
            ),
            measured_observation(
                "trace-outage",
                passed=False,
                observed_signal="exporter blocked the run",
            ),
        ],
    )

    assert report.hard_guardrails == "fail"
    assert report.measured_pass_rate == 0.5


def test_evaluation_rejects_unknown_or_duplicate_observations():
    cases = load_evaluation_cases(FIXTURE)[:1]
    observation = measured_observation(
        "trace-redaction",
        passed=True,
        observed_signal="ok",
    )

    with pytest.raises(EvaluationDefinitionError, match="duplicate observation"):
        build_evaluation_report(cases, [observation, observation])

    unknown = observation.model_copy(update={"case_id": "unknown"})
    with pytest.raises(EvaluationDefinitionError, match="unknown case"):
        build_evaluation_report(cases, [unknown])


def test_unmeasured_contract_cannot_claim_a_pass_value():
    with pytest.raises(ValidationError):
        OrchestrationEvaluationObservationV1(
            contract_version="orchestration-eval-observation-v1",
            case_id="trace-redaction",
            measured=False,
            passed=True,
            observed_signal="ok",
        )


def test_rollout_is_disabled_unless_flag_and_cohort_are_explicit():
    disabled = decide_rollout(
        orchestration_enabled=False,
        feature_cohort="demo-only",
        allowed_cohorts=["demo-only"],
    )
    shadow = decide_rollout(
        orchestration_enabled=True,
        feature_cohort="demo-only",
        allowed_cohorts=["demo-only"],
        shadow_mode=True,
    )
    blocked = decide_rollout(
        orchestration_enabled=True,
        feature_cohort="unknown",
        allowed_cohorts=["demo-only"],
    )
    allowlisted = decide_rollout(
        orchestration_enabled=True,
        feature_cohort="demo-only",
        allowed_cohorts=["demo-only"],
    )

    assert disabled.mode == "disabled"
    assert disabled.enabled is False
    assert shadow.mode == "shadow"
    assert shadow.enabled is True
    assert blocked.mode == "disabled"
    assert blocked.rollback_action == "disable_flag"
    assert allowlisted.mode == "allowlist"
    assert allowlisted.enabled is True


def test_shadow_report_compares_matching_scope_and_keeps_deltas():
    current = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="current",
        scope_key="profile-v1:strategy-v1:week-1",
        status="completed",
        valid=True,
        citation_count=4,
        latency_ms=100,
        cost_usd=0.02,
    )
    orchestrated = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="orchestrated",
        scope_key=current.scope_key,
        status="completed",
        valid=True,
        citation_count=5,
        latency_ms=125,
        cost_usd=0.03,
    )

    report = compare_shadow_paths(current, orchestrated)

    assert report.quality == "match"
    assert report.latency_delta_ms == 25
    assert report.cost_delta_usd == pytest.approx(0.01)
    assert report.citation_delta == 1


def test_shadow_report_does_not_compare_different_scopes_or_invent_missing_data():
    current = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="current",
        scope_key="scope-a",
        status="completed",
        valid=True,
    )
    missing = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="orchestrated",
        scope_key="scope-a",
        status="failed",
    )

    report = compare_shadow_paths(current, missing)

    assert report.quality == "unmeasured"
    assert report.latency_delta_ms is None
    assert report.cost_delta_usd is None
    assert report.citation_delta is None

    with pytest.raises(ValueError, match="same immutable scope"):
        compare_shadow_paths(
            current,
            missing.model_copy(update={"scope_key": "scope-b"}),
        )
