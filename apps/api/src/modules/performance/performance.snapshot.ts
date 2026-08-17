import {
  PERFORMANCE_METRICS,
  type MetricSnapshotV1,
  type PerformanceMetricName,
  type PerformanceWindow,
} from "@marketmind/contracts";
import type { PerformancePublicationContext } from "../publishing/performance/performance.repository";
import type { FacebookPerformanceObservation } from "./facebook-performance.provider";

/** Converts the allow-listed Meta response into the immutable wire contract. */
export function buildPerformanceSnapshot(input: {
  readonly window: {
    readonly sync_window_id: string;
    readonly publishing_result_id: string;
    readonly business_id: string;
    readonly window: PerformanceWindow;
    readonly due_at: string;
  };
  readonly context: PerformancePublicationContext;
  readonly observation: FacebookPerformanceObservation;
}): MetricSnapshotV1 {
  const byName = new Map(
    input.observation.metrics.map((metric) => [metric.name, metric]),
  );
  const metrics = Object.fromEntries(
    PERFORMANCE_METRICS.map((name) => {
      const metric = byName.get(name);
      const point = metric?.values
        .filter((candidate) => typeof candidate.value === "number")
        .sort(
          (left, right) => timestamp(right.endTime) - timestamp(left.endTime),
        )[0];
      if (
        !point ||
        typeof point.value !== "number" ||
        !Number.isFinite(point.value) ||
        point.value < 0
      ) {
        return [
          name,
          {
            status: "unavailable" as const,
            reason:
              metric && metric.values.length > 0
                ? ("invalid_value" as const)
                : ("not_returned" as const),
          },
        ];
      }
      return [name, { status: "available" as const, value: point.value }];
    }),
  ) as MetricSnapshotV1["metrics"];
  const observedAt =
    input.observation.metrics
      .flatMap((metric) => metric.values.map((point) => point.endTime))
      .filter(
        (value): value is string =>
          Boolean(value) && !Number.isNaN(Date.parse(value)),
      )
      .sort((left, right) => timestamp(right) - timestamp(left))[0] ?? null;
  const periods = [
    ...new Set(
      input.observation.metrics
        .map((metric) => metric.period)
        .filter((period): period is string => Boolean(period)),
    ),
  ].sort();
  const fetchedAt = input.observation.fetchedAt.toISOString();
  return {
    contract_version: "performance-v1",
    snapshot_id: input.window.sync_window_id,
    business_id: input.context.businessId,
    publishing_result_id: input.context.publishingResultId,
    publishing_attempt_id: input.context.publishingAttemptId,
    publication_intent_id: input.context.publicationIntentId,
    candidate_id: input.context.candidateId,
    candidate_checksum: input.context.candidateChecksum,
    provider: "facebook",
    provider_object_id: input.context.providerObjectId,
    window: input.window.window,
    published_at: input.context.publishedAt.toISOString(),
    due_at: input.window.due_at,
    observed_at: observedAt ? new Date(observedAt).toISOString() : null,
    fetched_at: fetchedAt,
    graph_version: input.observation.graphVersion,
    metric_schema_version: "facebook-insights-v1",
    metrics,
    provider_metadata: {
      source: "meta_insights",
      response_metric_count: input.observation.metrics.length,
      response_periods: periods,
    },
    created_at: fetchedAt,
  };
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function isPerformanceMetricName(
  value: string,
): value is PerformanceMetricName {
  return (PERFORMANCE_METRICS as readonly string[]).includes(value);
}
