import {
  PERFORMANCE_CONTRACT_VERSION,
  PERFORMANCE_ERROR_CODES,
  PERFORMANCE_METRICS,
  PERFORMANCE_METRIC_SCHEMA_VERSION,
  PERFORMANCE_PROVIDER,
  PERFORMANCE_SYNC_STATES,
  PERFORMANCE_UNAVAILABLE_REASONS,
  PERFORMANCE_WINDOWS,
  type MetricSnapshotV1,
  type PerformanceErrorCode,
  type PerformanceOverviewV1,
  type PerformancePostProjectionV1,
  type PerformanceProviderMetadataV1,
  type PerformanceSnapshotProjectionV1,
  type PerformanceSyncWindowV1,
} from "./performance-types";

export type PerformanceValidationIssue = {
  readonly field: string;
  readonly message: string;
};

export type PerformanceValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly PerformanceValidationIssue[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /T/;

function issue(field: string, message: string): PerformanceValidationIssue {
  return { field, message };
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): PerformanceValidationIssue[] {
  const allowed = new Set(keys);
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => issue(`${field}.${key}`, "field is outside performance-v1"));
}

function requireString(
  value: unknown,
  field: string,
  issues: PerformanceValidationIssue[],
): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue(field, "must be a non-empty string"));
    return false;
  }
  return true;
}

function requireUuid(
  value: unknown,
  field: string,
  issues: PerformanceValidationIssue[],
): value is string {
  if (!isUuid(value)) {
    issues.push(issue(field, "must be a UUID"));
    return false;
  }
  return true;
}

function requireDate(
  value: unknown,
  field: string,
  issues: PerformanceValidationIssue[],
): value is string {
  if (!isIsoDateTime(value)) {
    issues.push(issue(field, "must be an ISO date-time"));
    return false;
  }
  return true;
}

function requireEnum(
  value: unknown,
  allowed: readonly string[],
  field: string,
  issues: PerformanceValidationIssue[],
): boolean {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(issue(field, `must be one of ${allowed.join(", ")}`));
    return false;
  }
  return true;
}

function validateMetricValue(
  value: unknown,
  field: string,
): PerformanceValidationIssue[] {
  if (!objectValue(value)) return [issue(field, "must be an object")];
  const issues = hasOnlyKeys(value, ["status", "value", "reason"], field);
  if (value.status === "available") {
    if (
      typeof value.value !== "number" ||
      !Number.isFinite(value.value) ||
      value.value < 0
    ) {
      issues.push(
        issue(`${field}.value`, "must be a finite non-negative number"),
      );
    }
    if ("reason" in value) {
      issues.push(issue(`${field}.reason`, "must be absent when available"));
    }
  } else if (value.status === "unavailable") {
    if (
      !requireEnum(
        value.reason,
        PERFORMANCE_UNAVAILABLE_REASONS,
        `${field}.reason`,
        issues,
      )
    ) {
      // enum helper already recorded the issue
    }
    if ("value" in value) {
      issues.push(issue(`${field}.value`, "must be absent when unavailable"));
    }
  } else {
    issues.push(issue(`${field}.status`, "must be available or unavailable"));
  }
  return issues;
}

function validateMetrics(
  value: unknown,
  field: string,
): PerformanceValidationIssue[] {
  if (!objectValue(value)) return [issue(field, "must be an object")];
  const issues = hasOnlyKeys(value, PERFORMANCE_METRICS, field);
  for (const metric of PERFORMANCE_METRICS) {
    if (!(metric in value)) {
      issues.push(issue(`${field}.${metric}`, "is required"));
      continue;
    }
    issues.push(...validateMetricValue(value[metric], `${field}.${metric}`));
  }
  return issues;
}

function validateProviderMetadata(
  value: unknown,
  field: string,
): PerformanceValidationIssue[] {
  if (!objectValue(value)) return [issue(field, "must be an object")];
  const issues = hasOnlyKeys(
    value,
    ["source", "response_metric_count", "response_periods"],
    field,
  );
  if (value.source !== "meta_insights") {
    issues.push(issue(`${field}.source`, "must be meta_insights"));
  }
  if (
    typeof value.response_metric_count !== "number" ||
    !Number.isInteger(value.response_metric_count) ||
    value.response_metric_count < 0
  ) {
    issues.push(
      issue(`${field}.response_metric_count`, "must be a non-negative integer"),
    );
  }
  if (
    !Array.isArray(value.response_periods) ||
    value.response_periods.some(
      (period) => typeof period !== "string" || period.length === 0,
    )
  ) {
    issues.push(
      issue(
        `${field}.response_periods`,
        "must be an array of non-empty strings",
      ),
    );
  }
  return issues;
}

function validateCommonIdentity(
  value: Record<string, unknown>,
  field: string,
  issues: PerformanceValidationIssue[],
): void {
  if (value.contract_version !== PERFORMANCE_CONTRACT_VERSION) {
    issues.push(issue(`${field}.contract_version`, "must be performance-v1"));
  }
}

export function validatePerformanceSyncWindowV1(
  value: unknown,
): PerformanceValidationResult {
  const issues: PerformanceValidationIssue[] = [];
  if (!objectValue(value))
    return { valid: false, issues: [issue("window", "must be an object")] };
  issues.push(
    ...hasOnlyKeys(
      value,
      [
        "contract_version",
        "sync_window_id",
        "business_id",
        "publishing_result_id",
        "provider",
        "window",
        "due_at",
        "state",
        "attempt_count",
        "next_attempt_at",
        "lease_owner",
        "lease_expires_at",
        "last_error_code",
        "created_at",
        "updated_at",
      ],
      "window",
    ),
  );
  validateCommonIdentity(value, "window", issues);
  requireUuid(value.sync_window_id, "window.sync_window_id", issues);
  requireUuid(value.business_id, "window.business_id", issues);
  requireUuid(
    value.publishing_result_id,
    "window.publishing_result_id",
    issues,
  );
  if (value.provider !== PERFORMANCE_PROVIDER)
    issues.push(issue("window.provider", "must be facebook"));
  requireEnum(value.window, PERFORMANCE_WINDOWS, "window.window", issues);
  requireDate(value.due_at, "window.due_at", issues);
  requireEnum(value.state, PERFORMANCE_SYNC_STATES, "window.state", issues);
  if (
    typeof value.attempt_count !== "number" ||
    !Number.isInteger(value.attempt_count) ||
    value.attempt_count < 0
  )
    issues.push(
      issue("window.attempt_count", "must be a non-negative integer"),
    );
  for (const field of ["next_attempt_at", "lease_expires_at"]) {
    if (value[field] !== null)
      requireDate(value[field], `window.${field}`, issues);
  }
  if (value.lease_owner !== null && typeof value.lease_owner !== "string") {
    issues.push(issue("window.lease_owner", "must be a string or null"));
  }
  if (value.last_error_code !== null) {
    requireEnum(
      value.last_error_code,
      PERFORMANCE_ERROR_CODES,
      "window.last_error_code",
      issues,
    );
  }
  requireDate(value.created_at, "window.created_at", issues);
  requireDate(value.updated_at, "window.updated_at", issues);
  return { valid: issues.length === 0, issues };
}

export function validateMetricSnapshotV1(
  value: unknown,
): PerformanceValidationResult {
  const issues: PerformanceValidationIssue[] = [];
  if (!objectValue(value))
    return { valid: false, issues: [issue("snapshot", "must be an object")] };
  issues.push(
    ...hasOnlyKeys(
      value,
      [
        "contract_version",
        "snapshot_id",
        "business_id",
        "publishing_result_id",
        "publishing_attempt_id",
        "publication_intent_id",
        "candidate_id",
        "candidate_checksum",
        "provider",
        "provider_object_id",
        "window",
        "published_at",
        "due_at",
        "observed_at",
        "fetched_at",
        "graph_version",
        "metric_schema_version",
        "metrics",
        "provider_metadata",
        "created_at",
      ],
      "snapshot",
    ),
  );
  validateCommonIdentity(value, "snapshot", issues);
  for (const field of [
    "snapshot_id",
    "business_id",
    "publishing_result_id",
    "publishing_attempt_id",
    "publication_intent_id",
    "candidate_id",
  ])
    requireUuid(value[field], `snapshot.${field}`, issues);
  requireString(
    value.candidate_checksum,
    "snapshot.candidate_checksum",
    issues,
  );
  if (value.provider !== PERFORMANCE_PROVIDER)
    issues.push(issue("snapshot.provider", "must be facebook"));
  requireString(
    value.provider_object_id,
    "snapshot.provider_object_id",
    issues,
  );
  requireEnum(value.window, PERFORMANCE_WINDOWS, "snapshot.window", issues);
  for (const field of ["published_at", "due_at", "fetched_at"])
    requireDate(value[field], `snapshot.${field}`, issues);
  if (value.observed_at !== null)
    requireDate(value.observed_at, "snapshot.observed_at", issues);
  requireString(value.graph_version, "snapshot.graph_version", issues);
  if (value.metric_schema_version !== PERFORMANCE_METRIC_SCHEMA_VERSION) {
    issues.push(
      issue("snapshot.metric_schema_version", "must be facebook-insights-v1"),
    );
  }
  issues.push(...validateMetrics(value.metrics, "snapshot.metrics"));
  issues.push(
    ...validateProviderMetadata(
      value.provider_metadata,
      "snapshot.provider_metadata",
    ),
  );
  requireDate(value.created_at, "snapshot.created_at", issues);
  return { valid: issues.length === 0, issues };
}

function validateSnapshotProjection(
  value: unknown,
  field: string,
): PerformanceValidationIssue[] {
  if (!objectValue(value)) return [issue(field, "must be an object")];
  const issues = hasOnlyKeys(
    value,
    [
      "contract_version",
      "snapshot_id",
      "business_id",
      "publishing_result_id",
      "provider",
      "provider_object_id",
      "window",
      "published_at",
      "observed_at",
      "fetched_at",
      "metrics",
    ],
    field,
  );
  validateCommonIdentity(value, field, issues);
  requireUuid(value.snapshot_id, `${field}.snapshot_id`, issues);
  requireUuid(value.business_id, `${field}.business_id`, issues);
  requireUuid(
    value.publishing_result_id,
    `${field}.publishing_result_id`,
    issues,
  );
  if (value.provider !== PERFORMANCE_PROVIDER)
    issues.push(issue(`${field}.provider`, "must be facebook"));
  requireString(
    value.provider_object_id,
    `${field}.provider_object_id`,
    issues,
  );
  requireEnum(value.window, PERFORMANCE_WINDOWS, `${field}.window`, issues);
  requireDate(value.published_at, `${field}.published_at`, issues);
  if (value.observed_at !== null)
    requireDate(value.observed_at, `${field}.observed_at`, issues);
  requireDate(value.fetched_at, `${field}.fetched_at`, issues);
  issues.push(...validateMetrics(value.metrics, `${field}.metrics`));
  return issues;
}

export function validatePerformanceOverviewV1(
  value: unknown,
): PerformanceValidationResult {
  const issues: PerformanceValidationIssue[] = [];
  if (!objectValue(value))
    return { valid: false, issues: [issue("overview", "must be an object")] };
  issues.push(
    ...hasOnlyKeys(
      value,
      [
        "contract_version",
        "business_id",
        "provider",
        "generated_at",
        "posts",
        "baseline",
      ],
      "overview",
    ),
  );
  validateCommonIdentity(value, "overview", issues);
  requireUuid(value.business_id, "overview.business_id", issues);
  if (value.provider !== PERFORMANCE_PROVIDER)
    issues.push(issue("overview.provider", "must be facebook"));
  requireDate(value.generated_at, "overview.generated_at", issues);
  if (!Array.isArray(value.posts)) {
    issues.push(issue("overview.posts", "must be an array"));
  } else {
    value.posts.forEach((post, index) => {
      if (!objectValue(post)) {
        issues.push(issue(`overview.posts[${index}]`, "must be an object"));
        return;
      }
      issues.push(...validatePostProjection(post, `overview.posts[${index}]`));
    });
  }
  if (!objectValue(value.baseline)) {
    issues.push(issue("overview.baseline", "must be an object"));
  } else {
    issues.push(
      ...hasOnlyKeys(
        value.baseline,
        [
          "status",
          "observed_snapshot_count",
          "required_snapshot_count",
          "reason",
        ],
        "overview.baseline",
      ),
    );
    requireEnum(
      value.baseline.status,
      ["ready", "not_ready"],
      "overview.baseline.status",
      issues,
    );
    for (const field of [
      "observed_snapshot_count",
      "required_snapshot_count",
    ]) {
      if (
        typeof value.baseline[field] !== "number" ||
        !Number.isInteger(value.baseline[field]) ||
        value.baseline[field] < 0
      ) {
        issues.push(
          issue(`overview.baseline.${field}`, "must be a non-negative integer"),
        );
      }
    }
    if (
      value.baseline.reason !== null &&
      ![
        "no_published_posts",
        "insufficient_snapshots",
        "provider_unavailable",
      ].includes(value.baseline.reason as string)
    )
      issues.push(
        issue(
          "overview.baseline.reason",
          "has an unsupported readiness reason",
        ),
      );
    if (value.baseline.status === "ready" && value.baseline.reason !== null) {
      issues.push(issue("overview.baseline.reason", "must be null when ready"));
    }
  }
  return { valid: issues.length === 0, issues };
}

function validatePostProjection(
  value: Record<string, unknown>,
  field: string,
): PerformanceValidationIssue[] {
  const issues = hasOnlyKeys(
    value,
    [
      "contract_version",
      "business_id",
      "candidate_id",
      "publishing_result_id",
      "provider",
      "provider_object_id",
      "published_at",
      "snapshots",
    ],
    field,
  );
  validateCommonIdentity(value, field, issues);
  requireUuid(value.business_id, `${field}.business_id`, issues);
  requireUuid(value.candidate_id, `${field}.candidate_id`, issues);
  requireUuid(
    value.publishing_result_id,
    `${field}.publishing_result_id`,
    issues,
  );
  if (value.provider !== PERFORMANCE_PROVIDER)
    issues.push(issue(`${field}.provider`, "must be facebook"));
  requireString(
    value.provider_object_id,
    `${field}.provider_object_id`,
    issues,
  );
  requireDate(value.published_at, `${field}.published_at`, issues);
  if (!Array.isArray(value.snapshots)) {
    issues.push(issue(`${field}.snapshots`, "must be an array"));
  } else {
    value.snapshots.forEach((snapshot, index) => {
      issues.push(
        ...validateSnapshotProjection(snapshot, `${field}.snapshots[${index}]`),
      );
    });
  }
  return issues;
}

export function assertValidPerformanceSnapshot(
  value: unknown,
): asserts value is MetricSnapshotV1 {
  const result = validateMetricSnapshotV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function assertValidPerformanceSyncWindow(
  value: unknown,
): asserts value is PerformanceSyncWindowV1 {
  const result = validatePerformanceSyncWindowV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function assertValidPerformanceOverview(
  value: unknown,
): asserts value is PerformanceOverviewV1 {
  const result = validatePerformanceOverviewV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function isPerformanceErrorCode(
  value: unknown,
): value is PerformanceErrorCode {
  return (
    typeof value === "string" &&
    PERFORMANCE_ERROR_CODES.includes(value as PerformanceErrorCode)
  );
}

export type {
  PerformanceOverviewV1,
  PerformancePostProjectionV1,
  PerformanceProviderMetadataV1,
  PerformanceSnapshotProjectionV1,
};
