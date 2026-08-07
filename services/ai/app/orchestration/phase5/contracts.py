"""Versioned, sanitized contracts for Phase 5 trace and evaluation evidence."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, model_validator

from content_base import FrozenModel
from orchestration_contracts import IsoDateTime, SHA256, UUID


TraceEventType = Literal[
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
]


class TraceTokenUsageV1(FrozenModel):
    """Provider-reported token counts, when the provider exposes them."""

    prompt_tokens: int = Field(ge=0)
    completion_tokens: int = Field(ge=0)
    total_tokens: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_total(self) -> "TraceTokenUsageV1":
        if self.total_tokens < self.prompt_tokens + self.completion_tokens:
            raise ValueError("total_tokens cannot be below prompt plus completion tokens")
        return self


class OrchestrationTraceEventV1(FrozenModel):
    """A small trace envelope safe to persist or send to an exporter.

    ``details`` must already be passed through ``sanitize_trace_payload``.  The
    contract intentionally contains summaries and references, never prompt
    bodies, private profile documents, credentials, or hidden model reasoning.
    """

    contract_version: Literal["orchestration-trace-v1"]
    trace_id: UUID
    span_id: str = Field(min_length=1, max_length=128)
    parent_span_id: str | None = Field(default=None, max_length=128)
    run_id: UUID
    correlation_id: str = Field(min_length=1, max_length=256)
    environment: str = Field(min_length=1, max_length=64)
    feature_cohort: str = Field(min_length=1, max_length=128)
    graph_name: str = Field(min_length=1, max_length=128)
    graph_version: str = Field(min_length=1, max_length=128)
    event_type: TraceEventType
    status: str = Field(min_length=1, max_length=64)
    node: str | None = Field(default=None, max_length=128)
    role: str | None = Field(default=None, max_length=64)
    tool: str | None = Field(default=None, max_length=128)
    prompt_version: str | None = Field(default=None, max_length=128)
    provider: str | None = Field(default=None, max_length=128)
    model: str | None = Field(default=None, max_length=256)
    started_at: IsoDateTime
    finished_at: IsoDateTime
    latency_ms: float = Field(ge=0)
    retry_count: int = Field(default=0, ge=0)
    replan_count: int = Field(default=0, ge=0)
    token_usage: TraceTokenUsageV1 | None = None
    cost_usd: float | None = Field(default=None, ge=0)
    source_refs: list[str] = Field(default_factory=list, max_length=40)
    citation_count: int = Field(default=0, ge=0)
    validation_issue_codes: list[str] = Field(default_factory=list, max_length=20)
    approval_wait_reason: str | None = Field(default=None, max_length=300)
    summary: str = Field(min_length=1, max_length=500)
    details: dict[str, Any] = Field(default_factory=dict)


class OrchestrationTraceSnapshotV1(FrozenModel):
    """Bounded local evidence returned by a trace recorder."""

    contract_version: Literal["orchestration-trace-snapshot-v1"]
    trace_id: UUID
    run_id: UUID
    event_count: int = Field(ge=0)
    dropped_event_count: int = Field(ge=0)
    degraded_export: bool
    exporter_error_count: int = Field(ge=0)
    terminal_status: str | None = Field(default=None, max_length=64)
    total_latency_ms: float = Field(ge=0)
    total_tokens: int = Field(default=0, ge=0)
    total_cost_usd: float = Field(default=0, ge=0)
    events: list[OrchestrationTraceEventV1] = Field(default_factory=list, max_length=500)


EvaluationCategory = Literal[
    "safety",
    "durability",
    "approval",
    "bounded_execution",
    "observability",
    "quality",
]


class OrchestrationEvaluationCaseV1(FrozenModel):
    """Reviewed scenario metadata; it does not contain fabricated outcomes."""

    contract_version: Literal["orchestration-eval-case-v1"]
    case_id: str = Field(min_length=1, max_length=128)
    category: EvaluationCategory
    title: str = Field(min_length=1, max_length=240)
    hard_guardrail: bool = False
    smoke_supported: bool = False
    expected_signal: str = Field(min_length=1, max_length=300)
    measurement_note: str = Field(min_length=1, max_length=500)


class OrchestrationEvaluationObservationV1(FrozenModel):
    """One measured result, or an explicit unmeasured marker."""

    contract_version: Literal["orchestration-eval-observation-v1"]
    case_id: str = Field(min_length=1, max_length=128)
    measured: bool
    passed: bool | None = None
    observed_signal: str = Field(min_length=1, max_length=300)
    evidence: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_measurement(self) -> "OrchestrationEvaluationObservationV1":
        if self.measured and self.passed is None:
            raise ValueError("a measured observation must include passed=true or false")
        if not self.measured and self.passed is not None:
            raise ValueError("an unmeasured observation cannot include a pass/fail value")
        return self


class OrchestrationEvaluationReportV1(FrozenModel):
    """Evaluation summary that keeps missing evidence visible."""

    contract_version: Literal["orchestration-eval-report-v1"]
    suite_version: str = Field(min_length=1, max_length=128)
    generated_at: IsoDateTime
    total_cases: int = Field(ge=0)
    measured_cases: int = Field(ge=0)
    passed_cases: int = Field(ge=0)
    failed_cases: int = Field(ge=0)
    unmeasured_cases: int = Field(ge=0)
    measured_pass_rate: float | None = Field(default=None, ge=0, le=1)
    hard_guardrails: Literal["pass", "fail", "unmeasured"]
    cases: list[OrchestrationEvaluationObservationV1] = Field(
        default_factory=list, max_length=500
    )

    @model_validator(mode="after")
    def validate_counts(self) -> "OrchestrationEvaluationReportV1":
        if self.measured_cases + self.unmeasured_cases != self.total_cases:
            raise ValueError("evaluation case counts do not add up")
        if self.passed_cases + self.failed_cases != self.measured_cases:
            raise ValueError("measured pass/fail counts do not add up")
        if self.measured_cases == 0 and self.measured_pass_rate is not None:
            raise ValueError("pass rate must be null when no cases are measured")
        if self.measured_cases > 0 and self.measured_pass_rate is None:
            raise ValueError("pass rate is required when cases are measured")
        return self


class OrchestrationRolloutDecisionV1(FrozenModel):
    """Explicit rollout decision used by the Phase 5 runbook and tests."""

    contract_version: Literal["orchestration-rollout-v1"]
    enabled: bool
    mode: Literal["disabled", "shadow", "allowlist"]
    feature_cohort: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=1, max_length=300)
    rollback_action: Literal["none", "disable_flag"]


class ShadowPathSummaryV1(FrozenModel):
    """Sanitized comparable result from one current/orchestrated path."""

    contract_version: Literal["orchestration-shadow-summary-v1"]
    path: Literal["current", "orchestrated"]
    scope_key: str = Field(min_length=1, max_length=256)
    status: str = Field(min_length=1, max_length=64)
    valid: bool | None = None
    citation_count: int | None = Field(default=None, ge=0)
    latency_ms: float | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    publication_action_count: int = Field(default=0, ge=0)
    terminal_error_code: str | None = Field(default=None, max_length=128)


class ShadowComparisonReportV1(FrozenModel):
    """Comparison output with explicit quality and missing-data states."""

    contract_version: Literal["orchestration-shadow-report-v1"]
    scope_key: str = Field(min_length=1, max_length=256)
    generated_at: IsoDateTime
    quality: Literal["match", "regression", "improvement", "unmeasured"]
    current_valid: bool | None = None
    orchestrated_valid: bool | None = None
    latency_delta_ms: float | None = None
    cost_delta_usd: float | None = None
    citation_delta: int | None = None
    current_publication_action_count: int = Field(ge=0)
    orchestrated_publication_action_count: int = Field(ge=0)
    notes: list[str] = Field(default_factory=list, max_length=20)
