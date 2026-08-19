"""
Performance v1 contracts — Pydantic parity for packages/contracts/src/performance.

The surface is intentionally Facebook-only and reflects the live-confirmed
allowlist from issue #218. Metric availability is explicit so numeric zero is
never collapsed into a missing value.
"""

from __future__ import annotations

from datetime import datetime
from math import isclose
import re
from statistics import median
from typing import Annotated, Literal, Union
from uuid import UUID

from pydantic import Field, model_validator

from content_base import FrozenModel


PERFORMANCE_CONTRACT_VERSION = "performance-v1"
PERFORMANCE_PROVIDER = "facebook"
PERFORMANCE_METRIC_SCHEMA_VERSION = "facebook-insights-v1"
PERFORMANCE_WINDOWS = ("24h", "72h", "7d")
PERFORMANCE_METRICS = (
    "post_media_view",
    "post_total_media_view_unique",
    "post_clicks",
)

PerformanceWindow = Literal["24h", "72h", "7d"]
PerformanceSyncState = Literal[
    "queued", "leased", "succeeded", "retryable", "terminal"
]
PerformanceUnavailableReason = Literal[
    "not_returned",
    "unsupported",
    "permission_denied",
    "provider_error",
    "invalid_value",
    "not_yet_observed",
]
PerformanceErrorCode = Literal[
    "PERFORMANCE_NOT_ELIGIBLE",
    "PERFORMANCE_PERMISSION_REQUIRED",
    "PERFORMANCE_PROVIDER_RATE_LIMITED",
    "PERFORMANCE_PROVIDER_UNAVAILABLE",
    "PERFORMANCE_INVALID_PROVIDER_DATA",
    "PERFORMANCE_SNAPSHOT_CONFLICT",
    "PERFORMANCE_SYNC_WINDOW_CONFLICT",
    "PERFORMANCE_SNAPSHOT_IMMUTABLE",
    "PERFORMANCE_SYNC_TERMINAL",
]
NonNegativeFiniteNumber = Annotated[
    float,
    Field(strict=True, allow_inf_nan=False, ge=0),
]
NonNegativeInteger = Annotated[int, Field(strict=True, ge=0)]
PositiveInteger = Annotated[int, Field(strict=True, ge=1)]
NonEmptyString = Annotated[str, Field(min_length=1)]
OptimizationUntrustedString = Annotated[
    str, Field(min_length=1, max_length=8_000)
]
OptimizationOptionalUntrustedString = Annotated[str, Field(max_length=8_000)]
OptimizationGeneratedString = Annotated[
    str, Field(min_length=1, max_length=2_000)
]
OptimizationChecksum = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class PerformanceMetricAvailable(FrozenModel):
    status: Literal["available"]
    value: NonNegativeFiniteNumber


class PerformanceMetricUnavailable(FrozenModel):
    status: Literal["unavailable"]
    reason: PerformanceUnavailableReason


PerformanceMetricValueV1 = Annotated[
    Union[PerformanceMetricAvailable, PerformanceMetricUnavailable],
    Field(discriminator="status"),
]


class PerformanceMetricsV1(FrozenModel):
    post_media_view: PerformanceMetricValueV1
    post_total_media_view_unique: PerformanceMetricValueV1
    post_clicks: PerformanceMetricValueV1


class PerformanceProviderMetadataV1(FrozenModel):
    source: Literal["meta_insights"]
    response_metric_count: NonNegativeInteger
    response_periods: list[NonEmptyString]


class PerformanceSyncWindowV1(FrozenModel):
    contract_version: Literal["performance-v1"]
    sync_window_id: UUID
    business_id: UUID
    publishing_result_id: UUID
    provider: Literal["facebook"]
    window: PerformanceWindow
    due_at: datetime
    state: PerformanceSyncState
    attempt_count: NonNegativeInteger
    next_attempt_at: datetime | None
    lease_owner: str | None
    lease_expires_at: datetime | None
    last_error_code: PerformanceErrorCode | None
    created_at: datetime
    updated_at: datetime


class MetricSnapshotV1(FrozenModel):
    contract_version: Literal["performance-v1"]
    snapshot_id: UUID
    business_id: UUID
    publishing_result_id: UUID
    publishing_attempt_id: UUID
    publication_intent_id: UUID
    candidate_id: UUID
    candidate_checksum: NonEmptyString
    provider: Literal["facebook"]
    provider_object_id: NonEmptyString
    window: PerformanceWindow
    published_at: datetime
    due_at: datetime
    observed_at: datetime | None
    fetched_at: datetime
    graph_version: NonEmptyString
    metric_schema_version: Literal["facebook-insights-v1"]
    metrics: PerformanceMetricsV1
    provider_metadata: PerformanceProviderMetadataV1
    created_at: datetime


class PerformanceSnapshotProjectionV1(FrozenModel):
    contract_version: Literal["performance-v1"]
    snapshot_id: UUID
    business_id: UUID
    publishing_result_id: UUID
    provider: Literal["facebook"]
    provider_object_id: NonEmptyString
    window: PerformanceWindow
    published_at: datetime
    observed_at: datetime | None
    fetched_at: datetime
    metrics: PerformanceMetricsV1


class PerformancePostProjectionV1(FrozenModel):
    contract_version: Literal["performance-v1"]
    business_id: UUID
    candidate_id: UUID
    publishing_result_id: UUID
    provider: Literal["facebook"]
    provider_object_id: NonEmptyString
    published_at: datetime
    snapshots: list[PerformanceSnapshotProjectionV1]
    sync_windows: list[PerformanceSyncWindowV1] = Field(default_factory=list)


class PerformanceBaselineReadinessV1(FrozenModel):
    status: Literal["ready", "not_ready"]
    observed_snapshot_count: NonNegativeInteger
    required_snapshot_count: NonNegativeInteger
    reason: Literal[
        "no_published_posts", "insufficient_snapshots", "provider_unavailable"
    ] | None


class PerformanceCapabilityV1(FrozenModel):
    status: Literal["ready", "blocked", "unknown"]
    blockers: list[
        Literal[
            "no_facebook_connection",
            "connection_expired",
            "pages_read_engagement_permission_missing",
            "read_insights_permission_missing",
            "provider_unavailable",
        ]
    ]
    last_successful_sync: datetime | None


class PerformanceOverviewV1(FrozenModel):
    contract_version: Literal["performance-v1"]
    business_id: UUID
    provider: Literal["facebook"]
    generated_at: datetime
    posts: list[PerformancePostProjectionV1]
    baseline: PerformanceBaselineReadinessV1
    capability: PerformanceCapabilityV1 | None = None


# ---------------------------------------------------------------------------
# Optimization v1 — deterministic evidence in NestJS, bounded explanation in
# FastAPI.  These models intentionally contain no credentials or raw provider
# payloads.
# ---------------------------------------------------------------------------

OPTIMIZATION_CONTRACT_VERSION = "optimization-v1"
OPTIMIZATION_PROMPT_VERSION = "optimization-prompt-v1"
OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT = 3
OPTIMIZATION_REQUIRED_METRICS = ("post_media_view", "post_clicks")
OPTIMIZATION_PROHIBITED_CHANGES = (
    "strategy",
    "goal",
    "topic",
    "purpose",
    "audience",
    "channel",
    "locale",
    "format",
    "post_count",
    "media",
    "publishing_date",
    "publishing_time",
    "publishing_window",
    "offer",
    "business_facts",
    "already_created_content",
)

OptimizationChangeKind = Literal["hook_style", "cta_wording_style"]
OptimizationProposalStatus = Literal["PENDING_OWNER_DECISION"]
OptimizationReadinessStatus = Literal[
    "ready", "collecting_baseline", "insufficient_evidence"
]
OptimizationReadinessReason = Literal[
    "no_eligible_posts",
    "fewer_than_three_comparable_7d_snapshots",
    "missing_required_metric",
    "weak_signal",
    "snapshot_provenance_conflict",
    "format_required",
]
OptimizationNoRecommendationReason = Literal[
    "no_safe_change", "weak_signal", "provider_unavailable", "provider_invalid_output"
]
OptimizationMetricName = Literal["post_media_view", "post_clicks"]
OptimizationContentFormat = Literal["text_post", "static_image_post"]

_UNSUPPORTED_CLAIM_PATTERNS = (
    re.compile(r"\bguarantee(?:s|d)?\b", re.IGNORECASE),
    re.compile(r"\bproves?(?:\s+that)?\b", re.IGNORECASE),
    re.compile(
        r"\bcauses?\s+(?:higher|lower|more|fewer|an?\s+(?:increase|decrease))",
        re.IGNORECASE,
    ),
    re.compile(r"\bwill\s+(?:increase|improve|boost|raise|double)\b", re.IGNORECASE),
    re.compile(r"\bstatistically\s+significant\b", re.IGNORECASE),
    re.compile(
        r"\balways\s+(?:works?|wins?|outperforms?|performs?\s+best)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bis\s+(?:a\s+)?universal\s+(?:rule|best)\b", re.IGNORECASE),
    re.compile(r"(?:يضمن|مضمون(?:ة)?|يثبت\s+أن|دلالة\s+إحصائية|سيزيد|ستزيد|الأفضل\s+دائم(?:ا|ًا))"),
)
_PROHIBITED_SCOPE_DIRECTIVE = re.compile(
    r"\b(?:change|switch|replace|alter|reschedule|move|set|increase|decrease)\b"
    r".{0,80}\b(?:strategy|goal|topic|purpose|audience|channel|locale|format|"
    r"post\s+count|media|asset|publishing\s+(?:date|time|window)|schedule|offer|"
    r"business\s+facts?|created\s+content)\b",
    re.IGNORECASE,
)
_PROHIBITED_SCOPE_DIRECTIVE_AR = re.compile(
    r"(?:(?:يجب|ينبغي|اقترح|نوصي|جرّب|جرب|قم\s+ب)\s*ب?"
    r"(?:تغيير|تعديل|تبديل|نقل|تحديد)|(?:غيّر|بدّل|عدّل)).{0,80}"
    r"(?:الاستراتيجية|الهدف|الموضوع|الغرض|الجمهور|القناة|اللغة|التنسيق|"
    r"عدد\s+المنشورات|الوسائط|الأصل|موعد\s+النشر|وقت\s+النشر|الجدول|العرض|"
    r"حقائق\s+النشاط|المحتوى\s+المنشأ)"
)


def _validate_generated_text_policy(*values: str) -> None:
    for value in values:
        without_safe_claims = re.sub(
            r"\b(?:does\s+not|doesn't|cannot|can't|is\s+not|not)\s+"
            r"(?:guarantee|prove|cause|establish)\b",
            "",
            value,
            flags=re.IGNORECASE,
        )
        without_safe_claims = re.sub(
            r"\b(?:not|is\s+not|isn't)\s+statistically\s+significant\b",
            "",
            without_safe_claims,
            flags=re.IGNORECASE,
        )
        without_safe_claims = re.sub(
            r"(?:لا|لن)\s+(?:يضمن|يثبت|يسبب|يزيد)", "", without_safe_claims
        )
        without_safe_claims = re.sub(
            r"غير\s+مضمون(?:ة)?|ليست?\s+ذات\s+دلالة\s+إحصائية",
            "",
            without_safe_claims,
        )
        if any(pattern.search(without_safe_claims) for pattern in _UNSUPPORTED_CLAIM_PATTERNS):
            raise ValueError(
                "optimization text must not claim causality, guarantees, statistical significance, or a universal rule"
            )

        without_safe_scope = re.sub(
            r"\b(?:do\s+not|don't|never|without)\s+"
            r"(?:change|switch|replace|alter|reschedule|move|set|increase|decrease)\b"
            r".{0,80}\b(?:strategy|goal|topic|purpose|audience|channel|locale|format|"
            r"post\s+count|media|asset|publishing\s+(?:date|time|window)|schedule|"
            r"offer|business\s+facts?|created\s+content)\b",
            "",
            value,
            flags=re.IGNORECASE,
        )
        without_safe_scope = re.sub(
            r"(?:لا|دون)\s+(?:تغي[ّ]?ر|تبد[ّ]?ل|تعد[ّ]?ل).{0,80}"
            r"(?:الاستراتيجية|الهدف|الموضوع|الغرض|الجمهور|القناة|اللغة|التنسيق|"
            r"عدد\s+المنشورات|الوسائط|موعد\s+النشر|وقت\s+النشر|الجدول|العرض|"
            r"حقائق\s+النشاط|المحتوى\s+المنشأ)",
            "",
            without_safe_scope,
        )
        if _PROHIBITED_SCOPE_DIRECTIVE.search(
            without_safe_scope
        ) or _PROHIBITED_SCOPE_DIRECTIVE_AR.search(without_safe_scope):
            raise ValueError(
                "optimization text must not direct a change outside hook or CTA wording"
            )


class OptimizationMetricsV1(FrozenModel):
    post_media_view: PerformanceMetricValueV1
    post_clicks: PerformanceMetricValueV1


class OptimizationEvidenceV1(FrozenModel):
    snapshot_id: UUID
    business_id: UUID
    publishing_result_id: UUID
    candidate_id: UUID
    candidate_checksum: NonEmptyString
    strategy_id: UUID
    strategy_version: PositiveInteger
    content_cycle_id: UUID
    content_format: OptimizationContentFormat
    provider: Literal["facebook"]
    window: Literal["7d"]
    published_at: datetime
    observed_at: datetime
    metrics: OptimizationMetricsV1
    caption: OptimizationUntrustedString
    cta: OptimizationOptionalUntrustedString | None


class OptimizationComparisonV1(FrozenModel):
    metric: OptimizationMetricName
    baseline_median: NonNegativeFiniteNumber
    values: list[NonNegativeFiniteNumber] = Field(min_length=1)
    best_snapshot_id: UUID
    best_value: NonNegativeFiniteNumber
    delta_from_median: float
    delta_percent: float | None
    direction: Literal["higher_is_better"]


class OptimizationReadinessV1(FrozenModel):
    contract_version: Literal["optimization-v1"]
    status: OptimizationReadinessStatus
    business_id: UUID
    format_cohort: OptimizationContentFormat | None
    eligible_post_count: NonNegativeInteger
    required_post_count: Literal[3]
    required_metrics: list[OptimizationMetricName] = Field(min_length=2, max_length=2)
    available_formats: list[OptimizationContentFormat]
    reason: OptimizationReadinessReason | None

    @model_validator(mode="after")
    def require_frozen_metric_set(self):
        if tuple(self.required_metrics) != OPTIMIZATION_REQUIRED_METRICS:
            raise ValueError("required_metrics must match optimization-v1")
        return self


class OptimizationGenerationEvidenceV1(FrozenModel):
    snapshot_id: UUID
    candidate_id: UUID
    content_format: OptimizationContentFormat
    published_at: datetime
    metrics: OptimizationMetricsV1
    untrusted_caption: OptimizationUntrustedString
    untrusted_cta: OptimizationOptionalUntrustedString | None


class OptimizationGenerationIdentityV1(FrozenModel):
    business_id: UUID
    strategy_id: UUID
    strategy_version: PositiveInteger
    content_cycle_id: UUID
    format_cohort: OptimizationContentFormat


class OptimizationGenerationRequestV1(FrozenModel):
    contract_version: Literal["optimization-v1"]
    generation_fingerprint: OptimizationChecksum
    evidence_checksum: OptimizationChecksum
    identity: OptimizationGenerationIdentityV1
    evidence: list[OptimizationGenerationEvidenceV1]
    deterministic_comparison: list[OptimizationComparisonV1] = Field(min_length=1)
    allowed_change_kinds: list[OptimizationChangeKind] = Field(min_length=1)
    prohibited_changes: list[NonEmptyString] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_prepared_evidence(self):
        # Keep the endpoint's explicit typed baseline response authoritative for
        # short evidence lists; cross-field validation starts once eligibility
        # could otherwise be claimed.
        if len(self.evidence) < OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT:
            return self
        if len({item.snapshot_id for item in self.evidence}) != len(self.evidence):
            raise ValueError("optimization evidence snapshot IDs must be unique")
        if any(
            item.content_format != self.identity.format_cohort for item in self.evidence
        ):
            raise ValueError("optimization evidence format must match the identity")
        if tuple(self.prohibited_changes) != OPTIMIZATION_PROHIBITED_CHANGES:
            raise ValueError("prohibited_changes must match optimization-v1")
        if tuple(item.metric for item in self.deterministic_comparison) != (
            OPTIMIZATION_REQUIRED_METRICS
        ):
            raise ValueError(
                "deterministic comparisons must contain the frozen metric set"
            )

        for comparison in self.deterministic_comparison:
            prepared: list[tuple[str, float]] = []
            for evidence in self.evidence:
                metric_value = getattr(evidence.metrics, comparison.metric)
                if metric_value.status != "available":
                    raise ValueError(
                        "eligible optimization evidence must contain available metrics"
                    )
                prepared.append((str(evidence.snapshot_id), metric_value.value))
            expected_values = [value for _, value in prepared]
            if len(comparison.values) != len(expected_values) or any(
                not isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9)
                for actual, expected in zip(comparison.values, expected_values)
            ):
                raise ValueError(
                    "deterministic comparison values must match prepared evidence"
                )
            expected_median = float(median(expected_values))
            expected_best = max(expected_values)
            expected_delta = expected_best - expected_median
            expected_percent = (
                (expected_delta / expected_median) * 100
                if expected_median > 0
                else None
            )
            expected_best_id = sorted(
                snapshot_id
                for snapshot_id, value in prepared
                if isclose(value, expected_best, rel_tol=1e-9, abs_tol=1e-9)
            )[0]
            if not isclose(
                comparison.baseline_median,
                expected_median,
                rel_tol=1e-9,
                abs_tol=1e-9,
            ):
                raise ValueError("baseline_median must equal the deterministic median")
            if not isclose(
                comparison.best_value, expected_best, rel_tol=1e-9, abs_tol=1e-9
            ):
                raise ValueError("best_value must equal the best observed value")
            if str(comparison.best_snapshot_id) != expected_best_id:
                raise ValueError(
                    "best_snapshot_id must identify the canonical best evidence"
                )
            if not isclose(
                comparison.delta_from_median,
                expected_delta,
                rel_tol=1e-9,
                abs_tol=1e-9,
            ):
                raise ValueError("delta_from_median must be deterministic")
            if expected_percent is None:
                if comparison.delta_percent is not None:
                    raise ValueError("delta_percent must be null for a zero median")
            elif comparison.delta_percent is None or not isclose(
                comparison.delta_percent,
                expected_percent,
                rel_tol=1e-9,
                abs_tol=1e-9,
            ):
                raise ValueError("delta_percent must be deterministic")
        return self


class OptimizationAgentRecommendationV1(FrozenModel):
    contract_version: Literal["optimization-v1"]
    outcome: Literal["recommendation"]
    generation_fingerprint: OptimizationChecksum
    model_version: NonEmptyString
    prompt_version: Literal["optimization-prompt-v1"]
    evidence_snapshot_ids: list[UUID] = Field(min_length=3)
    change_kind: OptimizationChangeKind
    summary: OptimizationGeneratedString
    rationale: OptimizationGeneratedString
    uncertainty: OptimizationGeneratedString
    instruction: OptimizationGeneratedString

    @model_validator(mode="after")
    def reject_unsupported_claims(self):
        _validate_generated_text_policy(
            self.summary, self.rationale, self.uncertainty, self.instruction
        )
        return self


class OptimizationAgentNoRecommendationV1(FrozenModel):
    contract_version: Literal["optimization-v1"]
    outcome: Literal["no_recommendation"]
    generation_fingerprint: OptimizationChecksum
    model_version: NonEmptyString
    prompt_version: Literal["optimization-prompt-v1"]
    reason: OptimizationNoRecommendationReason


OptimizationAgentResultV1 = Annotated[
    Union[OptimizationAgentRecommendationV1, OptimizationAgentNoRecommendationV1],
    Field(discriminator="outcome"),
]


class OptimizationProposalV1(FrozenModel):
    contract_version: Literal["optimization-v1"]
    proposal_id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: PositiveInteger
    content_cycle_id: UUID
    format_cohort: OptimizationContentFormat
    basis_snapshot_ids: list[UUID] = Field(min_length=3)
    evidence_checksum: OptimizationChecksum
    deterministic_comparison: list[OptimizationComparisonV1] = Field(min_length=1)
    change_kind: OptimizationChangeKind
    summary: OptimizationGeneratedString
    rationale: OptimizationGeneratedString
    uncertainty: OptimizationGeneratedString
    instruction: OptimizationGeneratedString
    model_version: NonEmptyString
    prompt_version: Literal["optimization-prompt-v1"]
    generation_fingerprint: OptimizationChecksum
    status: Literal["PENDING_OWNER_DECISION"]
    created_at: datetime

    @model_validator(mode="after")
    def reject_unsupported_claims(self):
        _validate_generated_text_policy(
            self.summary, self.rationale, self.uncertainty, self.instruction
        )
        return self
