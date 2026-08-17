"""
Performance v1 contracts — Pydantic parity for packages/contracts/src/performance.

The surface is intentionally Facebook-only and reflects the live-confirmed
allowlist from issue #218. Metric availability is explicit so numeric zero is
never collapsed into a missing value.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Union
from uuid import UUID

from pydantic import Field

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
NonEmptyString = Annotated[str, Field(min_length=1)]


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
