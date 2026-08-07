"""Sanitized, non-blocking orchestration trace recording.

The local recorder is the source of demo evidence.  An exporter is optional
and deliberately injected so a tracing outage cannot change graph behavior or
force a Langfuse SDK/network dependency into the existing AI paths.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

from orchestration_contracts import CampaignOrchestrationEventV1

from app.core.config import Settings

from .contracts import (
    OrchestrationTraceEventV1,
    OrchestrationTraceSnapshotV1,
    TraceTokenUsageV1,
)


_PRIVATE_KEYS = {
    "system_prompt",
    "user_prompt",
    "prompt",
    "prompt_body",
    "raw_prompt",
    "messages",
    "raw_messages",
    "raw_response",
    "response_body",
    "raw_content",
    "content",
    "body",
    "text",
    "raw_text",
    "message",
    "response",
    "output",
    "output_body",
    "completion",
    "reasoning_trace",
    "chain_of_thought",
    "raw_provider_response",
    "raw_output",
    "business_profile",
    "profile",
    "content_request",
    "strategy_request",
    "research_pack",
    "retrieval_pack",
    "input_snapshot",
    "private_document",
    "content_body",
    "input_text",
    "output_text",
    "query_text",
    "candidate_text",
    "revision_notes",
    "weekly_context",
}
_SECRET_KEY_PARTS = (
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "cookie",
    "access_token",
    "refresh_token",
    "phone",
    "email",
    "whatsapp",
    "address",
)
_PHONE_PATTERN = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
_SOURCE_REF_KEYS = {"source_ref", "source_refs", "url", "uri"}
_FORBIDDEN_AUTOMATION_ACTIONS = {
    "publish",
    "publishing",
    "schedule",
    "scheduling",
    "spend",
    "spending",
    "send_external",
    "create_publication_candidate",
}


def _key_name(key: object) -> str:
    return str(key).strip().lower().replace("-", "_")


def _is_sensitive_key(key: str) -> bool:
    normalized = _key_name(key)
    if normalized == "prompt_version":
        return False
    return (
        normalized in _PRIVATE_KEYS
        or "prompt" in normalized
        or normalized == "token"
        or any(part in normalized for part in _SECRET_KEY_PARTS)
    )


def _safe_source_ref(value: str) -> str:
    """Keep a source identity while removing query/fragment credentials."""

    compact = " ".join(value.split())[:500]
    if _EMAIL_PATTERN.search(compact) or _PHONE_PATTERN.search(compact):
        return "[REDACTED]"
    try:
        parts = urlsplit(compact)
    except ValueError:
        return compact[:280]
    if parts.scheme and parts.netloc:
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))[:280]
    return compact[:280]


def _safe_string(value: str, *, key: str = "") -> str:
    if _is_sensitive_key(key):
        return "[REDACTED]"
    if not _UUID_PATTERN.fullmatch(value) and (
        _EMAIL_PATTERN.search(value) or _PHONE_PATTERN.search(value)
    ):
        return "[REDACTED]"
    return " ".join(value.split())[:280]


def _safe_summary(value: str) -> str:
    """Keep operational summaries while rejecting likely raw prompt text."""

    compact = " ".join(value.split())[:500]
    lowered = compact.casefold()
    if (
        re.search(r"\b(?:system|user|developer)\s+prompt\b", lowered)
        or re.search(r"\b(?:prompt|messages?)\s*[:=]", lowered)
        or "do not export" in lowered
        or "ignore previous instructions" in lowered
        or "chain of thought" in lowered
    ):
        return "[REDACTED]"
    return _safe_string(compact)


def sanitize_trace_value(value: Any, *, key: str = "") -> Any:
    """Recursively redact private values and bound the trace payload.

    This function is intentionally independent from provider prompts and is
    safe to apply again to an already-sanitized event.  It keeps IDs, enum
    values, counts, and source references useful while dropping raw content.
    """

    normalized = _key_name(key)
    if normalized in _SOURCE_REF_KEYS:
        if isinstance(value, str):
            return _safe_source_ref(value)
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            return [_safe_source_ref(str(item)) for item in list(value)[:40]]
    if _is_sensitive_key(normalized):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {
            str(child_key): sanitize_trace_value(child_value, key=str(child_key))
            for child_key, child_value in list(value.items())[:50]
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [sanitize_trace_value(item, key=key) for item in list(value)[:40]]
    if isinstance(value, bytes):
        return "[BINARY_REDACTED]"
    if isinstance(value, str):
        return _safe_string(value, key=normalized)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _safe_string(str(value), key=normalized)


def sanitize_trace_payload(
    value: Mapping[str, Any] | None,
    *,
    max_bytes: int = 12_000,
) -> dict[str, Any]:
    """Return bounded JSON-safe details or a non-sensitive truncation marker."""

    if max_bytes <= 0:
        raise ValueError("max_bytes must be positive")
    sanitized = sanitize_trace_value(dict(value or {}))
    if not isinstance(sanitized, dict):
        sanitized = {"value": sanitized}
    encoded = json.dumps(
        sanitized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    if len(encoded) <= max_bytes:
        return sanitized
    return {
        "truncated": True,
        "original_bytes": len(encoded),
        "reason": "trace_detail_size_limit",
    }


def _iso(value: datetime | str) -> str:
    if isinstance(value, datetime):
        current = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
        return current.astimezone(UTC).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        )
    return value


def _latency_ms(started_at: datetime | str, finished_at: datetime | str) -> float:
    if isinstance(started_at, datetime) and isinstance(finished_at, datetime):
        return max(0.0, (finished_at - started_at).total_seconds() * 1000)
    return 0.0


def make_trace_event(
    *,
    trace_id: str,
    span_id: str,
    run_id: str,
    correlation_id: str,
    environment: str,
    feature_cohort: str,
    graph_name: str,
    graph_version: str,
    event_type: str,
    status: str,
    started_at: datetime | str,
    finished_at: datetime | str,
    summary: str,
    parent_span_id: str | None = None,
    node: str | None = None,
    role: str | None = None,
    tool: str | None = None,
    prompt_version: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    latency_ms: float | None = None,
    retry_count: int = 0,
    replan_count: int = 0,
    token_usage: TraceTokenUsageV1 | None = None,
    cost_usd: float | None = None,
    source_refs: Sequence[str] = (),
    citation_count: int = 0,
    validation_issue_codes: Sequence[str] = (),
    approval_wait_reason: str | None = None,
    details: Mapping[str, Any] | None = None,
) -> OrchestrationTraceEventV1:
    """Build one redacted trace event from bounded scalar metadata."""

    allowed_types = {
        "run",
        "node",
        "tool",
        "model",
        "retrieval",
        "validation",
        "interrupt",
        "resume",
        "terminal",
        "error",
    }
    normalized_type = event_type if event_type in allowed_types else "error"
    return OrchestrationTraceEventV1(
        contract_version="orchestration-trace-v1",
        trace_id=trace_id,
        span_id=span_id,
        parent_span_id=parent_span_id,
        run_id=run_id,
        correlation_id=correlation_id,
        environment=_safe_string(environment),
        feature_cohort=_safe_string(feature_cohort),
        graph_name=_safe_string(graph_name),
        graph_version=_safe_string(graph_version),
        event_type=normalized_type,
        status=_safe_string(status),
        node=_safe_string(node) if node else None,
        role=_safe_string(role) if role else None,
        tool=_safe_string(tool) if tool else None,
        prompt_version=_safe_string(prompt_version) if prompt_version else None,
        provider=_safe_string(provider) if provider else None,
        model=_safe_string(model) if model else None,
        started_at=_iso(started_at),
        finished_at=_iso(finished_at),
        latency_ms=(
            max(0.0, latency_ms)
            if latency_ms is not None
            else _latency_ms(started_at, finished_at)
        ),
        retry_count=retry_count,
        replan_count=replan_count,
        token_usage=token_usage,
        cost_usd=cost_usd,
        source_refs=[_safe_source_ref(str(ref)) for ref in list(source_refs)[:40]],
        citation_count=citation_count,
        validation_issue_codes=[str(code)[:128] for code in list(validation_issue_codes)[:20]],
        approval_wait_reason=(
            _safe_string(approval_wait_reason) if approval_wait_reason else None
        ),
        summary=_safe_summary(summary),
        details=sanitize_trace_payload(details),
    )


def _sanitize_trace_event(event: OrchestrationTraceEventV1) -> OrchestrationTraceEventV1:
    """Sanitize every free-text field before local storage or export."""

    return event.model_copy(
        update={
            "source_refs": [
                _safe_source_ref(str(ref)) for ref in list(event.source_refs)[:40]
            ],
            "validation_issue_codes": [
                str(code)[:128] for code in list(event.validation_issue_codes)[:20]
            ],
            "approval_wait_reason": (
                _safe_summary(event.approval_wait_reason)
                if event.approval_wait_reason
                else None
            ),
            "summary": _safe_summary(event.summary),
            "details": sanitize_trace_payload(event.details),
        }
    )


def trace_event_from_orchestration_event(
    event: CampaignOrchestrationEventV1,
    *,
    environment: str,
    feature_cohort: str,
    graph_name: str = "campaign-v1",
    graph_version: str = "unknown",
    trace_id: str | None = None,
) -> OrchestrationTraceEventV1:
    """Adapt a Nest-owned sanitized event into the local trace envelope."""

    mapping = {
        "run_created": "run",
        "node_started": "node",
        "node_completed": "node",
        "tool_started": "tool",
        "tool_completed": "tool",
        "validation": "validation",
        "interrupt": "interrupt",
        "resume": "resume",
        "terminal": "terminal",
        "error": "error",
    }
    return make_trace_event(
        trace_id=trace_id or event.run_id,
        span_id=f"event-{event.seq}",
        run_id=event.run_id,
        correlation_id=str(event.payload.get("correlation_id", event.run_id)),
        environment=environment,
        feature_cohort=feature_cohort,
        graph_name=graph_name,
        graph_version=graph_version,
        event_type=mapping.get(event.event_type, "error"),
        status=event.status,
        started_at=event.created_at,
        finished_at=event.created_at,
        summary=event.summary,
        node=event.node,
        tool=event.tool,
        details=event.payload,
    )


def publication_actions(
    events: Sequence[OrchestrationTraceEventV1],
) -> tuple[OrchestrationTraceEventV1, ...]:
    """Find explicit automation actions, not explanatory words in summaries."""

    matches: list[OrchestrationTraceEventV1] = []
    for event in events:
        candidates = [event.tool]
        action = event.details.get("action") if isinstance(event.details, dict) else None
        candidates.append(action if isinstance(action, str) else None)
        if any(
            candidate and candidate.strip().lower() in _FORBIDDEN_AUTOMATION_ACTIONS
            for candidate in candidates
        ):
            matches.append(event)
    return tuple(matches)


class TraceExporter(Protocol):
    async def export(self, event: OrchestrationTraceEventV1) -> None:
        """Send one already-sanitized event to an external trace backend."""


ExporterTransport = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass(frozen=True)
class LangfuseTraceConfig:
    """Configuration passed to the reviewed Langfuse adapter boundary."""

    enabled: bool = False
    environment: str = "local"
    public_key: str | None = None
    secret_key: str | None = None
    endpoint: str | None = None


def trace_config_from_settings(settings: Settings) -> LangfuseTraceConfig:
    """Translate deployment settings without enabling network export by default."""

    return LangfuseTraceConfig(
        enabled=(
            settings.ai_orchestration_trace_enabled
            and settings.ai_orchestration_trace_exporter == "langfuse"
        ),
        environment=settings.ai_orchestration_trace_environment,
    )


class LangfuseObservationExporter:
    """Map safe events to a transport-owned Langfuse observation payload.

    The transport is injected by deployment code.  Tests and the default local
    path never make a network request, and an external SDK/version is not
    silently installed by the orchestration feature.
    """

    def __init__(
        self,
        transport: ExporterTransport,
        *,
        config: LangfuseTraceConfig,
    ) -> None:
        self.transport = transport
        self.config = config

    async def export(self, event: OrchestrationTraceEventV1) -> None:
        if not self.config.enabled:
            return
        await self.transport(to_langfuse_observation(event, self.config))


def to_langfuse_observation(
    event: OrchestrationTraceEventV1,
    config: LangfuseTraceConfig,
) -> dict[str, Any]:
    """Return only sanitized fields for the deployment's Langfuse client."""

    safe_event = _sanitize_trace_event(event)
    metadata = sanitize_trace_payload(
        {
            "environment": config.environment,
            "feature_cohort": safe_event.feature_cohort,
            "graph_name": safe_event.graph_name,
            "graph_version": safe_event.graph_version,
            "status": safe_event.status,
            "node": safe_event.node,
            "role": safe_event.role,
            "tool": safe_event.tool,
            "prompt_version": safe_event.prompt_version,
            "provider": safe_event.provider,
            "model": safe_event.model,
            "retry_count": safe_event.retry_count,
            "replan_count": safe_event.replan_count,
            "citation_count": safe_event.citation_count,
            "validation_issue_codes": safe_event.validation_issue_codes,
            "approval_wait_reason": safe_event.approval_wait_reason,
            "details": safe_event.details,
        }
    )
    return {
        "name": f"marketmind.orchestration.{safe_event.event_type}",
        "trace_id": safe_event.trace_id,
        "observation_id": safe_event.span_id,
        "type": "GENERATION" if safe_event.event_type == "model" else "SPAN",
        "start_time": safe_event.started_at,
        "end_time": safe_event.finished_at,
        "input": {"summary": safe_event.summary},
        "output": {"status": safe_event.status},
        "metadata": metadata,
        "usage": (
            safe_event.token_usage.model_dump(mode="json")
            if safe_event.token_usage is not None
            else None
        ),
        "cost": safe_event.cost_usd,
    }


@dataclass
class InMemoryTraceSink:
    """Bounded local trace store used by tests, CI, and the demo fallback."""

    max_events: int = 500
    _events: list[OrchestrationTraceEventV1] = field(default_factory=list)
    _dropped_event_count: int = 0
    _dropped_by_scope: dict[tuple[str, str], int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.max_events <= 0:
            raise ValueError("max_events must be positive")

    async def emit(self, event: OrchestrationTraceEventV1) -> None:
        safe_event = _sanitize_trace_event(event)
        if len(self._events) >= self.max_events:
            dropped = self._events.pop(0)
            self._dropped_event_count += 1
            scope = (str(dropped.trace_id), str(dropped.run_id))
            self._dropped_by_scope[scope] = self._dropped_by_scope.get(scope, 0) + 1
        self._events.append(safe_event)

    async def flush(self) -> None:
        return None

    @property
    def events(self) -> tuple[OrchestrationTraceEventV1, ...]:
        return tuple(self._events)

    def snapshot(
        self,
        *,
        trace_id: str,
        run_id: str,
        degraded_export: bool = False,
        exporter_error_count: int = 0,
    ) -> OrchestrationTraceSnapshotV1:
        trace_id = str(trace_id)
        run_id = str(run_id)
        scoped_events = [
            event
            for event in self._events
            if str(event.trace_id) == trace_id and str(event.run_id) == run_id
        ]
        scope = (trace_id, run_id)
        terminal_status = next(
            (
                event.status
                for event in reversed(scoped_events)
                if event.event_type == "terminal"
            ),
            None,
        )
        total_tokens = sum(
            event.token_usage.total_tokens
            for event in scoped_events
            if event.token_usage is not None
        )
        total_cost = sum(
            event.cost_usd or 0 for event in scoped_events if event.cost_usd is not None
        )
        return OrchestrationTraceSnapshotV1(
            contract_version="orchestration-trace-snapshot-v1",
            trace_id=trace_id,
            run_id=run_id,
            event_count=len(scoped_events),
            dropped_event_count=self._dropped_by_scope.get(scope, 0),
            degraded_export=degraded_export,
            exporter_error_count=exporter_error_count,
            terminal_status=terminal_status,
            total_latency_ms=sum(event.latency_ms for event in scoped_events),
            total_tokens=total_tokens,
            total_cost_usd=total_cost,
            events=scoped_events,
        )


class NonBlockingTraceSink:
    """Record locally immediately and export in detached, bounded tasks."""

    def __init__(
        self,
        local: InMemoryTraceSink | None = None,
        exporter: TraceExporter | None = None,
        *,
        export_timeout_seconds: float = 0.5,
    ) -> None:
        if export_timeout_seconds <= 0:
            raise ValueError("export_timeout_seconds must be positive")
        self.local = local or InMemoryTraceSink()
        self.exporter = exporter
        self.export_timeout_seconds = export_timeout_seconds
        self.degraded_export = False
        self.exporter_error_count = 0
        self._degraded_scopes: set[tuple[str, str]] = set()
        self._exporter_error_counts: dict[tuple[str, str], int] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    async def emit(self, event: OrchestrationTraceEventV1) -> None:
        safe_event = _sanitize_trace_event(event)
        await self.local.emit(safe_event)
        if self.exporter is None:
            return
        task = asyncio.create_task(self._export(safe_event))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _export(self, event: OrchestrationTraceEventV1) -> None:
        try:
            result = self.exporter.export(event)
            if inspect.isawaitable(result):
                await asyncio.wait_for(result, timeout=self.export_timeout_seconds)
        except Exception:
            # A trace backend is never allowed to fail the graph or its owner
            # decision.  The local snapshot exposes this degraded state.
            self.degraded_export = True
            self.exporter_error_count += 1
            scope = (str(event.trace_id), str(event.run_id))
            self._degraded_scopes.add(scope)
            self._exporter_error_counts[scope] = self._exporter_error_counts.get(scope, 0) + 1

    async def flush(self) -> None:
        if not self._tasks:
            return
        await asyncio.gather(*tuple(self._tasks), return_exceptions=True)

    def snapshot(self, *, trace_id: str, run_id: str) -> OrchestrationTraceSnapshotV1:
        trace_id = str(trace_id)
        run_id = str(run_id)
        scope = (trace_id, run_id)
        return self.local.snapshot(
            trace_id=trace_id,
            run_id=run_id,
            degraded_export=scope in self._degraded_scopes,
            exporter_error_count=self._exporter_error_counts.get(scope, 0),
        )


def exporter_from_callable(
    callback: ExporterTransport,
    *,
    enabled: bool = True,
    environment: str = "local",
) -> LangfuseObservationExporter:
    """Small integration seam for a configured Langfuse/OTel transport."""

    return LangfuseObservationExporter(
        callback,
        config=LangfuseTraceConfig(enabled=enabled, environment=environment),
    )
