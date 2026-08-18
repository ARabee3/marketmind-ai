import {
  computeOptimizationEvidenceChecksum,
  OPTIMIZATION_FORMATS,
  OPTIMIZATION_REQUIRED_METRICS,
  OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT,
  type OptimizationComparisonV1,
  type OptimizationEvidenceV1,
  type OptimizationFormat,
  type OptimizationReadinessV1,
  type PerformanceMetricValueV1,
} from "@marketmind/contracts";

export type OptimizationSnapshotInput = {
  readonly snapshot_id: string;
  readonly business_id: string;
  readonly publishing_result_id: string;
  readonly candidate_id: string;
  readonly candidate_checksum: string;
  readonly strategy_id: string;
  readonly strategy_version: number;
  readonly content_cycle_id: string;
  readonly content_format: OptimizationFormat;
  readonly provider: "facebook";
  readonly window: "7d";
  readonly published_at: string;
  readonly observed_at: string | null;
  readonly metrics: {
    readonly post_media_view: PerformanceMetricValueV1;
    readonly post_clicks: PerformanceMetricValueV1;
  };
  readonly caption: string;
  readonly cta: string | null;
};

export type OptimizationAnalysis = {
  readonly readiness: OptimizationReadinessV1;
  readonly format_cohort: OptimizationFormat | null;
  readonly identity: {
    readonly business_id: string;
    readonly strategy_id: string;
    readonly strategy_version: number;
    readonly content_cycle_id: string;
    readonly format_cohort: OptimizationFormat;
  } | null;
  readonly evidence: readonly OptimizationEvidenceV1[];
  readonly comparisons: readonly OptimizationComparisonV1[];
  readonly evidence_checksum: string | null;
};

type IdentityKey = string;

function identityKey(snapshot: OptimizationSnapshotInput): IdentityKey {
  return [
    snapshot.business_id,
    snapshot.strategy_id,
    snapshot.strategy_version,
    snapshot.content_cycle_id,
    snapshot.content_format,
  ].join("|");
}

function isAvailable(
  value: PerformanceMetricValueV1,
): value is { readonly status: "available"; readonly value: number } {
  return value.status === "available";
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function readiness(
  businessId: string,
  formatCohort: OptimizationFormat | null,
  eligiblePostCount: number,
  availableFormats: readonly OptimizationFormat[],
  reason: OptimizationReadinessV1["reason"],
): OptimizationReadinessV1 {
  const insufficientEvidence =
    reason === "weak_signal" ||
    reason === "missing_required_metric" ||
    reason === "snapshot_provenance_conflict";
  return {
    contract_version: "optimization-v1",
    status: insufficientEvidence
      ? "insufficient_evidence"
      : eligiblePostCount >= OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT
        ? "ready"
        : "collecting_baseline",
    business_id: businessId,
    format_cohort: formatCohort,
    eligible_post_count: eligiblePostCount,
    required_post_count: OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT,
    required_metrics: OPTIMIZATION_REQUIRED_METRICS,
    available_formats: availableFormats,
    reason:
      insufficientEvidence ||
      eligiblePostCount < OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT
        ? reason
        : null,
  };
}

function asEvidence(
  snapshot: OptimizationSnapshotInput,
): OptimizationEvidenceV1 {
  if (!snapshot.observed_at) {
    throw new Error("Optimization evidence requires an observed snapshot");
  }
  return {
    snapshot_id: snapshot.snapshot_id,
    business_id: snapshot.business_id,
    publishing_result_id: snapshot.publishing_result_id,
    candidate_id: snapshot.candidate_id,
    candidate_checksum: snapshot.candidate_checksum,
    strategy_id: snapshot.strategy_id,
    strategy_version: snapshot.strategy_version,
    content_cycle_id: snapshot.content_cycle_id,
    content_format: snapshot.content_format,
    provider: "facebook",
    window: "7d",
    published_at: snapshot.published_at,
    observed_at: snapshot.observed_at,
    metrics: {
      post_media_view: snapshot.metrics.post_media_view,
      post_clicks: snapshot.metrics.post_clicks,
    },
    caption: snapshot.caption,
    cta: snapshot.cta,
  };
}

function comparisonFor(
  evidence: readonly OptimizationEvidenceV1[],
  metric: (typeof OPTIMIZATION_REQUIRED_METRICS)[number],
): OptimizationComparisonV1 {
  const observations = evidence
    .map((item) => ({
      snapshot_id: item.snapshot_id,
      value: item.metrics[metric],
    }))
    .filter(
      (
        item,
      ): item is {
        snapshot_id: string;
        value: { status: "available"; value: number };
      } => isAvailable(item.value),
    );
  const values = observations.map((item) => item.value.value);
  const baselineMedian = median(values);
  const best = [...observations].sort(
    (left, right) =>
      right.value.value - left.value.value ||
      left.snapshot_id.localeCompare(right.snapshot_id),
  )[0];
  return {
    metric,
    baseline_median: baselineMedian,
    values,
    best_snapshot_id: best.snapshot_id,
    best_value: best.value.value,
    delta_from_median: best.value.value - baselineMedian,
    delta_percent:
      baselineMedian > 0
        ? ((best.value.value - baselineMedian) / baselineMedian) * 100
        : null,
    direction: "higher_is_better",
  };
}

/**
 * Selects one exact business/Strategy/cycle/format cohort and computes all
 * comparison values without consulting an AI provider. Missing metrics are
 * excluded from a cohort rather than coerced to zero.
 */
export function analyzeOptimizationSnapshots(input: {
  readonly business_id: string;
  readonly snapshots: readonly OptimizationSnapshotInput[];
  readonly requested_format?: OptimizationFormat;
}): OptimizationAnalysis {
  const availableFormats = [
    ...new Set(
      input.snapshots
        .filter(
          (snapshot) =>
            snapshot.business_id === input.business_id &&
            snapshot.provider === "facebook" &&
            snapshot.window === "7d" &&
            isOptimizationFormat(snapshot.content_format),
        )
        .map((snapshot) => snapshot.content_format),
    ),
  ].sort() as OptimizationFormat[];

  const duplicateIds = new Set<string>();
  for (const snapshot of input.snapshots) {
    if (duplicateIds.has(snapshot.snapshot_id)) {
      return {
        readiness: readiness(
          input.business_id,
          input.requested_format ?? null,
          0,
          availableFormats,
          "snapshot_provenance_conflict",
        ),
        format_cohort: input.requested_format ?? null,
        identity: null,
        evidence: [],
        comparisons: [],
        evidence_checksum: null,
      };
    }
    duplicateIds.add(snapshot.snapshot_id);
  }

  const candidates = input.snapshots.filter(
    (snapshot) =>
      snapshot.business_id === input.business_id &&
      snapshot.provider === "facebook" &&
      snapshot.window === "7d" &&
      isOptimizationFormat(snapshot.content_format) &&
      snapshot.observed_at !== null &&
      (!input.requested_format ||
        snapshot.content_format === input.requested_format),
  );
  const groups = new Map<IdentityKey, OptimizationSnapshotInput[]>();
  for (const snapshot of candidates) {
    const key = identityKey(snapshot);
    const group = groups.get(key) ?? [];
    group.push(snapshot);
    groups.set(key, group);
  }

  const chosenGroup =
    [...groups.values()].sort((left, right) => {
      const leftCompleteCount = left.filter(
        (snapshot) =>
          isAvailable(snapshot.metrics.post_media_view) &&
          isAvailable(snapshot.metrics.post_clicks),
      ).length;
      const rightCompleteCount = right.filter(
        (snapshot) =>
          isAvailable(snapshot.metrics.post_media_view) &&
          isAvailable(snapshot.metrics.post_clicks),
      ).length;
      const completeCountDifference = rightCompleteCount - leftCompleteCount;
      if (completeCountDifference !== 0) return completeCountDifference;
      const countDifference = right.length - left.length;
      if (countDifference !== 0) return countDifference;
      const leftKey = left[0] ? identityKey(left[0]) : "";
      const rightKey = right[0] ? identityKey(right[0]) : "";
      return leftKey.localeCompare(rightKey);
    })[0] ?? [];
  const selectedFormat =
    chosenGroup[0]?.content_format ?? input.requested_format ?? null;
  const complete = chosenGroup.filter(
    (snapshot) =>
      isAvailable(snapshot.metrics.post_media_view) &&
      isAvailable(snapshot.metrics.post_clicks),
  );

  if (complete.length < OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT) {
    const reason =
      chosenGroup.length >= OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT
        ? "missing_required_metric"
        : chosenGroup.length === 0
          ? "no_eligible_posts"
          : "fewer_than_three_comparable_7d_snapshots";
    return {
      readiness: readiness(
        input.business_id,
        selectedFormat,
        complete.length,
        availableFormats,
        reason,
      ),
      format_cohort: selectedFormat,
      identity: chosenGroup[0]
        ? {
            business_id: chosenGroup[0].business_id,
            strategy_id: chosenGroup[0].strategy_id,
            strategy_version: chosenGroup[0].strategy_version,
            content_cycle_id: chosenGroup[0].content_cycle_id,
            format_cohort: chosenGroup[0].content_format,
          }
        : null,
      evidence: [],
      comparisons: [],
      evidence_checksum: null,
    };
  }

  const evidence = complete
    .sort((left, right) => left.snapshot_id.localeCompare(right.snapshot_id))
    .map(asEvidence);
  const comparisons = OPTIMIZATION_REQUIRED_METRICS.map((metric) =>
    comparisonFor(evidence, metric),
  );
  if (!comparisons.some((comparison) => comparison.delta_from_median > 0)) {
    return {
      readiness: readiness(
        input.business_id,
        firstFormat(evidence),
        evidence.length,
        availableFormats,
        "weak_signal",
      ),
      format_cohort: firstFormat(evidence),
      identity: null,
      evidence: [],
      comparisons: [],
      evidence_checksum: null,
    };
  }
  const first = evidence[0];
  const identity = {
    business_id: first.business_id,
    strategy_id: first.strategy_id,
    strategy_version: first.strategy_version,
    content_cycle_id: first.content_cycle_id,
    format_cohort: first.content_format,
  };
  return {
    readiness: readiness(
      input.business_id,
      first.content_format,
      evidence.length,
      availableFormats,
      null,
    ),
    format_cohort: first.content_format,
    identity,
    evidence,
    comparisons,
    evidence_checksum: computeOptimizationEvidenceChecksum(evidence),
  };
}

function firstFormat(
  evidence: readonly OptimizationEvidenceV1[],
): OptimizationFormat {
  const first = evidence[0];
  if (!first) throw new Error("Optimization evidence cannot be empty");
  return first.content_format;
}

function isOptimizationFormat(value: string): value is OptimizationFormat {
  return OPTIMIZATION_FORMATS.includes(value as OptimizationFormat);
}
