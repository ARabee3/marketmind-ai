import { createHash } from "node:crypto";

import {
  type PerformanceMetricName,
  type PerformanceMetricValueV1,
} from "./performance-types";

export const OPTIMIZATION_CONTRACT_VERSION = "optimization-v1" as const;
export const OPTIMIZATION_PROMPT_VERSION = "optimization-prompt-v1" as const;
export const OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT = 3 as const;
export const OPTIMIZATION_MAX_UNTRUSTED_TEXT_LENGTH = 8_000 as const;
export const OPTIMIZATION_MAX_GENERATED_TEXT_LENGTH = 2_000 as const;
export const OPTIMIZATION_FORMATS = ["text_post", "static_image_post"] as const;
export type OptimizationFormat = (typeof OPTIMIZATION_FORMATS)[number];
export const OPTIMIZATION_REQUIRED_METRICS = [
  "post_media_view",
  "post_clicks",
] as const satisfies readonly PerformanceMetricName[];
export type OptimizationMetricName =
  (typeof OPTIMIZATION_REQUIRED_METRICS)[number];

export const OPTIMIZATION_CHANGE_KINDS = [
  "hook_style",
  "cta_wording_style",
] as const;
export type OptimizationChangeKind = (typeof OPTIMIZATION_CHANGE_KINDS)[number];

export const OPTIMIZATION_PROPOSAL_STATUSES = [
  "PENDING_OWNER_DECISION",
] as const;
export type OptimizationProposalStatus =
  (typeof OPTIMIZATION_PROPOSAL_STATUSES)[number];

export const OPTIMIZATION_READINESS_STATUSES = [
  "ready",
  "collecting_baseline",
  "insufficient_evidence",
] as const;
export type OptimizationReadinessStatus =
  (typeof OPTIMIZATION_READINESS_STATUSES)[number];

export const OPTIMIZATION_READINESS_REASONS = [
  "no_eligible_posts",
  "fewer_than_three_comparable_7d_snapshots",
  "missing_required_metric",
  "weak_signal",
  "snapshot_provenance_conflict",
  "format_required",
] as const;
export type OptimizationReadinessReason =
  (typeof OPTIMIZATION_READINESS_REASONS)[number];

export const OPTIMIZATION_NO_RECOMMENDATION_REASONS = [
  "no_safe_change",
  "weak_signal",
  "provider_unavailable",
  "provider_invalid_output",
] as const;
export type OptimizationNoRecommendationReason =
  (typeof OPTIMIZATION_NO_RECOMMENDATION_REASONS)[number];

export const OPTIMIZATION_PROHIBITED_CHANGES = [
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
] as const;

export type OptimizationMetricsV1 = {
  readonly post_media_view: PerformanceMetricValueV1;
  readonly post_clicks: PerformanceMetricValueV1;
};

/** A sanitized reference to one immutable 7-day observation. */
export type OptimizationEvidenceV1 = {
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
  readonly observed_at: string;
  readonly metrics: OptimizationMetricsV1;
  /** Candidate copy is untrusted data for the AI prompt, never instructions. */
  readonly caption: string;
  readonly cta: string | null;
};

export type OptimizationComparisonV1 = {
  readonly metric: OptimizationMetricName;
  readonly baseline_median: number;
  readonly values: readonly number[];
  readonly best_snapshot_id: string;
  readonly best_value: number;
  readonly delta_from_median: number;
  readonly delta_percent: number | null;
  readonly direction: "higher_is_better";
};

export type OptimizationReadinessV1 = {
  readonly contract_version: typeof OPTIMIZATION_CONTRACT_VERSION;
  readonly status: OptimizationReadinessStatus;
  readonly business_id: string;
  readonly format_cohort: OptimizationFormat | null;
  readonly eligible_post_count: number;
  readonly required_post_count: typeof OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT;
  readonly required_metrics: typeof OPTIMIZATION_REQUIRED_METRICS;
  readonly available_formats: readonly OptimizationFormat[];
  readonly reason: OptimizationReadinessReason | null;
};

export type OptimizationGenerationEvidenceV1 = {
  readonly snapshot_id: string;
  readonly candidate_id: string;
  readonly content_format: OptimizationFormat;
  readonly published_at: string;
  readonly metrics: OptimizationMetricsV1;
  /** This value is explicitly quoted/untrusted in the provider prompt. */
  readonly untrusted_caption: string;
  readonly untrusted_cta: string | null;
};

export type OptimizationGenerationRequestV1 = {
  readonly contract_version: typeof OPTIMIZATION_CONTRACT_VERSION;
  readonly generation_fingerprint: string;
  readonly evidence_checksum: string;
  readonly identity: {
    readonly business_id: string;
    readonly strategy_id: string;
    readonly strategy_version: number;
    readonly content_cycle_id: string;
    readonly format_cohort: OptimizationFormat;
  };
  readonly evidence: readonly OptimizationGenerationEvidenceV1[];
  readonly deterministic_comparison: readonly OptimizationComparisonV1[];
  readonly allowed_change_kinds: readonly OptimizationChangeKind[];
  readonly prohibited_changes: readonly string[];
};

export type OptimizationAgentRecommendationV1 = {
  readonly contract_version: typeof OPTIMIZATION_CONTRACT_VERSION;
  readonly outcome: "recommendation";
  readonly generation_fingerprint: string;
  readonly model_version: string;
  readonly prompt_version: typeof OPTIMIZATION_PROMPT_VERSION;
  readonly evidence_snapshot_ids: readonly string[];
  readonly change_kind: OptimizationChangeKind;
  readonly summary: string;
  readonly rationale: string;
  readonly uncertainty: string;
  readonly instruction: string;
};

export type OptimizationAgentNoRecommendationV1 = {
  readonly contract_version: typeof OPTIMIZATION_CONTRACT_VERSION;
  readonly outcome: "no_recommendation";
  readonly generation_fingerprint: string;
  readonly model_version: string;
  readonly prompt_version: typeof OPTIMIZATION_PROMPT_VERSION;
  readonly reason: OptimizationNoRecommendationReason;
};

export type OptimizationAgentResultV1 =
  | OptimizationAgentRecommendationV1
  | OptimizationAgentNoRecommendationV1;

export type OptimizationProposalV1 = {
  readonly contract_version: typeof OPTIMIZATION_CONTRACT_VERSION;
  readonly proposal_id: string;
  readonly business_id: string;
  readonly strategy_id: string;
  readonly strategy_version: number;
  readonly content_cycle_id: string;
  readonly format_cohort: OptimizationFormat;
  readonly basis_snapshot_ids: readonly string[];
  readonly evidence_checksum: string;
  readonly deterministic_comparison: readonly OptimizationComparisonV1[];
  readonly change_kind: OptimizationChangeKind;
  readonly summary: string;
  readonly rationale: string;
  readonly uncertainty: string;
  readonly instruction: string;
  readonly model_version: string;
  readonly prompt_version: string;
  readonly generation_fingerprint: string;
  readonly status: "PENDING_OWNER_DECISION";
  readonly created_at: string;
};

type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return null;
}

export function canonicalOptimizationEvidencePayload(
  evidence: readonly OptimizationEvidenceV1[],
): string {
  return JSON.stringify(
    canonicalize(
      evidence.map(
        ({ caption: _caption, cta: _cta, ...reference }) => reference,
      ),
    ),
  );
}

export function computeOptimizationEvidenceChecksum(
  evidence: readonly OptimizationEvidenceV1[],
): string {
  return createHash("sha256")
    .update(canonicalOptimizationEvidencePayload(evidence), "utf8")
    .digest("hex");
}

export function computeOptimizationGenerationFingerprint(
  request: Omit<OptimizationGenerationRequestV1, "generation_fingerprint">,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(request)), "utf8")
    .digest("hex");
}
