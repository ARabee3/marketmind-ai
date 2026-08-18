import type { IsoDateTime, UUID } from "../content/content-types";

export type { IsoDateTime, UUID };

export const PERFORMANCE_CONTRACT_VERSION = "performance-v1" as const;
export const PERFORMANCE_PROVIDER = "facebook" as const;
export const PERFORMANCE_METRIC_SCHEMA_VERSION =
  "facebook-insights-v1" as const;

export const PERFORMANCE_WINDOWS = ["24h", "72h", "7d"] as const;
export type PerformanceWindow = (typeof PERFORMANCE_WINDOWS)[number];

/** Frozen by the live Facebook Insights capability verification in #218. */
export const PERFORMANCE_METRICS = [
  "post_media_view",
  "post_total_media_view_unique",
  "post_clicks",
] as const;
export type PerformanceMetricName = (typeof PERFORMANCE_METRICS)[number];

export const PERFORMANCE_SYNC_STATES = [
  "queued",
  "leased",
  "succeeded",
  "retryable",
  "terminal",
] as const;
export type PerformanceSyncState = (typeof PERFORMANCE_SYNC_STATES)[number];

export const PERFORMANCE_UNAVAILABLE_REASONS = [
  "not_returned",
  "unsupported",
  "permission_denied",
  "provider_error",
  "invalid_value",
  "not_yet_observed",
] as const;
export type PerformanceUnavailableReason =
  (typeof PERFORMANCE_UNAVAILABLE_REASONS)[number];

export const PERFORMANCE_ERROR_CODES = [
  "PERFORMANCE_NOT_ELIGIBLE",
  "PERFORMANCE_PERMISSION_REQUIRED",
  "PERFORMANCE_PROVIDER_RATE_LIMITED",
  "PERFORMANCE_PROVIDER_UNAVAILABLE",
  "PERFORMANCE_INVALID_PROVIDER_DATA",
  "PERFORMANCE_SNAPSHOT_CONFLICT",
  "PERFORMANCE_SYNC_WINDOW_CONFLICT",
  "PERFORMANCE_SNAPSHOT_IMMUTABLE",
  "PERFORMANCE_SYNC_TERMINAL",
] as const;
export type PerformanceErrorCode = (typeof PERFORMANCE_ERROR_CODES)[number];

export type PerformanceMetricValueV1 =
  | {
      readonly status: "available";
      readonly value: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: PerformanceUnavailableReason;
    };

export type PerformanceMetricsV1 = {
  readonly [Metric in PerformanceMetricName]: PerformanceMetricValueV1;
};

/** Provider metadata is deliberately a closed, sanitized projection. */
export type PerformanceProviderMetadataV1 = {
  readonly source: "meta_insights";
  readonly response_metric_count: number;
  readonly response_periods: readonly string[];
};

export type PerformanceSyncWindowV1 = {
  readonly contract_version: typeof PERFORMANCE_CONTRACT_VERSION;
  readonly sync_window_id: UUID;
  readonly business_id: UUID;
  readonly publishing_result_id: UUID;
  readonly provider: typeof PERFORMANCE_PROVIDER;
  readonly window: PerformanceWindow;
  readonly due_at: IsoDateTime;
  readonly state: PerformanceSyncState;
  readonly attempt_count: number;
  readonly next_attempt_at: IsoDateTime | null;
  readonly lease_owner: string | null;
  readonly lease_expires_at: IsoDateTime | null;
  readonly last_error_code: PerformanceErrorCode | null;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export type MetricSnapshotV1 = {
  readonly contract_version: typeof PERFORMANCE_CONTRACT_VERSION;
  readonly snapshot_id: UUID;
  readonly business_id: UUID;
  readonly publishing_result_id: UUID;
  readonly publishing_attempt_id: UUID;
  readonly publication_intent_id: UUID;
  readonly candidate_id: UUID;
  readonly candidate_checksum: string;
  readonly provider: typeof PERFORMANCE_PROVIDER;
  readonly provider_object_id: string;
  readonly window: PerformanceWindow;
  readonly published_at: IsoDateTime;
  readonly due_at: IsoDateTime;
  readonly observed_at: IsoDateTime | null;
  readonly fetched_at: IsoDateTime;
  readonly graph_version: string;
  readonly metric_schema_version: typeof PERFORMANCE_METRIC_SCHEMA_VERSION;
  readonly metrics: PerformanceMetricsV1;
  readonly provider_metadata: PerformanceProviderMetadataV1;
  readonly created_at: IsoDateTime;
};

export type PerformanceSnapshotProjectionV1 = Pick<
  MetricSnapshotV1,
  | "contract_version"
  | "snapshot_id"
  | "business_id"
  | "publishing_result_id"
  | "provider"
  | "provider_object_id"
  | "window"
  | "published_at"
  | "observed_at"
  | "fetched_at"
  | "metrics"
>;

export type PerformancePostProjectionV1 = {
  readonly contract_version: typeof PERFORMANCE_CONTRACT_VERSION;
  readonly business_id: UUID;
  readonly candidate_id: UUID;
  readonly publishing_result_id: UUID;
  readonly provider: typeof PERFORMANCE_PROVIDER;
  readonly provider_object_id: string;
  readonly published_at: IsoDateTime;
  readonly snapshots: readonly PerformanceSnapshotProjectionV1[];
  /** Mutable collection state is projected separately from immutable evidence. */
  readonly sync_windows?: readonly PerformanceSyncWindowV1[];
};

export type PerformanceBaselineReadinessV1 = {
  readonly status: "ready" | "not_ready";
  readonly observed_snapshot_count: number;
  readonly required_snapshot_count: number;
  readonly reason:
    | "no_published_posts"
    | "insufficient_snapshots"
    | "provider_unavailable"
    | null;
};

/**
 * Monitoring capability is deliberately separate from publishing readiness.
 * A Page may remain publishable while Insights collection is blocked or
 * disconnected.
 */
export type PerformanceCapabilityV1 = {
  readonly status: "ready" | "blocked" | "unknown";
  readonly blockers: readonly (
    | "no_facebook_connection"
    | "connection_expired"
    | "pages_read_engagement_permission_missing"
    | "read_insights_permission_missing"
    | "provider_unavailable"
  )[];
  readonly last_successful_sync: IsoDateTime | null;
};

export type PerformanceOverviewV1 = {
  readonly contract_version: typeof PERFORMANCE_CONTRACT_VERSION;
  readonly business_id: UUID;
  readonly provider: typeof PERFORMANCE_PROVIDER;
  readonly generated_at: IsoDateTime;
  readonly posts: readonly PerformancePostProjectionV1[];
  readonly baseline: PerformanceBaselineReadinessV1;
  /** Added by the synchronization API; optional for backwards-compatible
   *  consumers of the Performance 1 contract. */
  readonly capability?: PerformanceCapabilityV1;
};
