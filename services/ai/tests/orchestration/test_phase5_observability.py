from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from orchestration_contracts import CampaignOrchestrationEventV1

from app.orchestration.phase5 import (
    InMemoryTraceSink,
    NonBlockingTraceSink,
    OrchestrationTraceEventV1,
    TraceTokenUsageV1,
    LangfuseTraceConfig,
    make_trace_event,
    publication_actions,
    sanitize_trace_payload,
    trace_config_from_settings,
    to_langfuse_observation,
    trace_event_from_orchestration_event,
)
from app.core.config import Settings


RUN_ID = "11111111-1111-4111-8111-111111111111"
STARTED = datetime(2026, 8, 7, 8, 0, tzinfo=UTC)
FINISHED = STARTED + timedelta(milliseconds=125)


def _event(**updates) -> OrchestrationTraceEventV1:
    values = {
        "trace_id": RUN_ID,
        "span_id": "span-1",
        "run_id": RUN_ID,
        "correlation_id": "corr-1",
        "environment": "test",
        "feature_cohort": "phase5-tests",
        "graph_name": "campaign-v1",
        "graph_version": "2026-08-07",
        "event_type": "node",
        "status": "running",
        "node": "strategy",
        "role": "strategy",
        "started_at": STARTED,
        "finished_at": FINISHED,
        "summary": "Strategy node completed.",
        "details": {"strategy_id": "55555555-5555-4555-8555-555555555555"},
    }
    values.update(updates)
    return make_trace_event(**values)


def test_trace_sanitizer_keeps_operational_fields_and_redacts_private_data():
    details = sanitize_trace_payload(
        {
            "strategy_id": "55555555-5555-4555-8555-555555555555",
            "system_prompt": "Never export this prompt.",
            "prompt": "DO NOT EXPORT ME",
            "promptBody": "DO NOT EXPORT THIS EITHER",
            "messages": [{"role": "user", "content": "private"}],
            "business_profile": {"phone": "+201000000000", "name": "Private"},
            "owner_email": "owner@example.test",
            "source_ref": "https://example.test/evidence?id=secret&token=abc",
            "tool_calls": 3,
        }
    )

    assert details["strategy_id"].startswith("5555")
    assert details["system_prompt"] == "[REDACTED]"
    assert details["prompt"] == "[REDACTED]"
    assert details["promptBody"] == "[REDACTED]"
    assert details["messages"] == "[REDACTED]"
    assert details["business_profile"] == "[REDACTED]"
    assert details["owner_email"] == "[REDACTED]"
    assert details["source_ref"] == "https://example.test/evidence"
    assert details["tool_calls"] == 3
    assert "Never export" not in json.dumps(details)


@pytest.mark.asyncio
async def test_local_trace_snapshot_isolated_by_trace_and_run():
    other_run = "22222222-2222-4222-8222-222222222222"
    sink = InMemoryTraceSink()
    await sink.emit(_event())
    await sink.emit(
        _event(
            trace_id=other_run,
            run_id=other_run,
            span_id="other-terminal",
            event_type="terminal",
            status="failed",
        )
    )

    snapshot = sink.snapshot(trace_id=RUN_ID, run_id=RUN_ID)

    assert snapshot.event_count == 1
    assert snapshot.terminal_status is None
    assert all(event.run_id == RUN_ID for event in snapshot.events)


def test_trace_exporter_sanitizes_events_that_bypass_make_trace_event():
    unsafe = _event().model_copy(
        update={
            "summary": "DO NOT EXPORT ME",
            "approval_wait_reason": "User prompt: private",
            "details": {"prompt": "private", "messages": ["private"]},
        }
    )

    payload = to_langfuse_observation(
        unsafe,
        LangfuseTraceConfig(enabled=True, environment="test"),
    )

    encoded = json.dumps(payload)
    assert "DO NOT EXPORT ME" not in encoded
    assert "private" not in encoded


@pytest.mark.asyncio
async def test_local_trace_is_bounded_and_aggregates_tokens_cost_and_terminal_status():
    sink = InMemoryTraceSink(max_events=2)
    await sink.emit(
        _event(
            span_id="span-1",
            token_usage=TraceTokenUsageV1(
                prompt_tokens=10,
                completion_tokens=4,
                total_tokens=14,
            ),
            cost_usd=0.01,
        )
    )
    await sink.emit(_event(span_id="span-2"))
    await sink.emit(
        _event(
            span_id="span-3",
            event_type="terminal",
            status="completed",
        )
    )

    snapshot = sink.snapshot(trace_id=RUN_ID, run_id=RUN_ID)

    assert snapshot.event_count == 2
    assert snapshot.dropped_event_count == 1
    assert snapshot.terminal_status == "completed"
    assert snapshot.total_tokens == 0  # the bounded store dropped the first event
    assert snapshot.total_cost_usd == 0


@pytest.mark.asyncio
async def test_exporter_failure_is_non_blocking_and_visible_as_degraded():
    class FailingExporter:
        async def export(self, event):
            raise RuntimeError("trace backend unavailable")

    sink = NonBlockingTraceSink(
        InMemoryTraceSink(),
        FailingExporter(),
        export_timeout_seconds=0.05,
    )
    await sink.emit(_event())
    await sink.flush()

    snapshot = sink.snapshot(trace_id=RUN_ID, run_id=RUN_ID)
    assert snapshot.event_count == 1
    assert snapshot.degraded_export is True
    assert snapshot.exporter_error_count == 1


@pytest.mark.asyncio
async def test_slow_exporter_does_not_delay_local_recording_beyond_schedule():
    release = asyncio.Event()

    class SlowExporter:
        async def export(self, event):
            await release.wait()

    sink = NonBlockingTraceSink(
        InMemoryTraceSink(),
        SlowExporter(),
        export_timeout_seconds=0.01,
    )
    await asyncio.wait_for(sink.emit(_event()), timeout=0.1)
    assert len(sink.local.events) == 1
    await sink.flush()
    assert sink.degraded_export is True
    release.set()


def test_orchestration_event_adapter_and_langfuse_payload_are_sanitized():
    event = CampaignOrchestrationEventV1(
        contract_version="orchestration-v1",
        event_id="99999999-9999-4999-8999-999999999999",
        run_id=RUN_ID,
        seq=2,
        event_type="tool_completed",
        status="running",
        current_role="research",
        current_stage="research",
        node="research",
        tool="calculate_strategy_decisions",
        summary="Tool completed.",
        payload={
            "correlation_id": "corr-1",
            "source_ref": "https://example.test/source?token=secret",
            "system_prompt": "private",
        },
        created_at="2026-08-07T08:00:00.000Z",
    )

    trace = trace_event_from_orchestration_event(
        event,
        environment="test",
        feature_cohort="phase5-tests",
    )
    payload = to_langfuse_observation(
        trace,
        LangfuseTraceConfig(enabled=True, environment="test"),
    )

    assert trace.event_type == "tool"
    assert trace.tool == "calculate_strategy_decisions"
    assert trace.details["system_prompt"] == "[REDACTED]"
    assert payload["trace_id"] == RUN_ID
    assert payload["metadata"]["environment"] == "test"
    assert "private" not in json.dumps(payload)


def test_publication_check_uses_explicit_actions_not_explanatory_text():
    explanatory = _event(
        summary="Publishing remains outside the orchestration graph.",
        details={"action": "owner_decision"},
    )
    explicit = _event(
        span_id="span-publish",
        tool="publish",
        details={"action": "publish"},
    )

    assert publication_actions([explanatory]) == ()
    assert publication_actions([explanatory, explicit]) == (explicit,)


def test_trace_export_is_independently_disabled_by_default():
    local = trace_config_from_settings(Settings(ai_provider_mode="mock"))
    configured = trace_config_from_settings(
        Settings(
            ai_provider_mode="mock",
            ai_orchestration_trace_enabled=True,
            ai_orchestration_trace_exporter="langfuse",
            ai_orchestration_trace_environment="ci",
        )
    )

    assert local.enabled is False
    assert local.environment == "local"
    assert configured.enabled is True
    assert configured.environment == "ci"
