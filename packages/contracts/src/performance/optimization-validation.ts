import {
  OPTIMIZATION_CHANGE_KINDS,
  OPTIMIZATION_CONTRACT_VERSION,
  OPTIMIZATION_DECISION_ACTIONS,
  OPTIMIZATION_DECISION_CONTRACT_VERSION,
  OPTIMIZATION_FORMATS,
  OPTIMIZATION_INSTRUCTION_CONTRACT_VERSION,
  OPTIMIZATION_INSTRUCTION_STATUSES,
  OPTIMIZATION_MAX_GENERATED_TEXT_LENGTH,
  OPTIMIZATION_MAX_UNTRUSTED_TEXT_LENGTH,
  OPTIMIZATION_NO_RECOMMENDATION_REASONS,
  OPTIMIZATION_PROHIBITED_CHANGES,
  OPTIMIZATION_PROMPT_VERSION,
  OPTIMIZATION_READINESS_REASONS,
  OPTIMIZATION_READINESS_STATUSES,
  OPTIMIZATION_REQUIRED_METRICS,
  OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT,
  OPTIMIZATION_PROPOSAL_WORKSPACE_STATES,
  type OptimizationAgentResultV1,
  type ApprovedOptimizationInstructionV1,
  type OptimizationDecisionV1,
  type OptimizationDecisionResponseV1,
  type OptimizationProposalWorkspaceV1,
  type OptimizationProposalV1,
} from "./optimization-types";
import { PERFORMANCE_UNAVAILABLE_REASONS } from "./performance-types";

export type OptimizationValidationIssue = {
  readonly field: string;
  readonly message: string;
};

export type OptimizationValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly OptimizationValidationIssue[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bguarantee(?:s|d)?\b/i,
  /\bproves?(?:\s+that)?\b/i,
  /\bcauses?\s+(?:higher|lower|more|fewer|an?\s+(?:increase|decrease))/i,
  /\bwill\s+(?:increase|improve|boost|raise|double)\b/i,
  /\bstatistically\s+significant\b/i,
  /\balways\s+(?:works?|wins?|outperforms?|performs?\s+best)\b/i,
  /\bis\s+(?:a\s+)?universal\s+(?:rule|best)\b/i,
  /(?:يضمن|مضمون(?:ة)?|يثبت\s+أن|دلالة\s+إحصائية|سيزيد|ستزيد|الأفضل\s+دائم(?:ا|ًا))/u,
] as const;
const PROHIBITED_SCOPE_DIRECTIVE =
  /\b(?:change|switch|replace|alter|reschedule|move|set|increase|decrease)\b.{0,80}\b(?:strategy|goal|topic|purpose|audience|channel|locale|format|post\s+count|media|asset|publishing\s+(?:date|time|window)|schedule|offer|business\s+facts?|created\s+content)\b/i;
const PROHIBITED_SCOPE_DIRECTIVE_AR =
  /(?:(?:يجب|ينبغي|اقترح|نوصي|جرّب|جرب|قم\s+ب)\s*ب?(?:تغيير|تعديل|تبديل|نقل|تحديد)|(?:غيّر|بدّل|عدّل)).{0,80}(?:الاستراتيجية|الهدف|الموضوع|الغرض|الجمهور|القناة|اللغة|التنسيق|عدد\s+المنشورات|الوسائط|الأصل|موعد\s+النشر|وقت\s+النشر|الجدول|العرض|حقائق\s+النشاط|المحتوى\s+المنشأ)/u;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function date(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeNumber(value: unknown): value is number {
  return number(value) && value >= 0;
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): OptimizationValidationIssue[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value)
    .filter((key) => !allowedSet.has(key))
    .map((key) => ({
      field: `${field}.${key}`,
      message: "field is outside optimization-v1",
    }));
}

function requireUuid(
  value: unknown,
  field: string,
  issues: OptimizationValidationIssue[],
): void {
  if (!uuid(value)) issues.push({ field, message: "must be a UUID" });
}

function requireString(
  value: unknown,
  field: string,
  issues: OptimizationValidationIssue[],
): void {
  if (!string(value))
    issues.push({ field, message: "must be a non-empty string" });
}

function requireChecksum(
  value: unknown,
  field: string,
  issues: OptimizationValidationIssue[],
): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    issues.push({ field, message: "must be a lowercase SHA-256 checksum" });
  }
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  issues: OptimizationValidationIssue[],
): void {
  if (!string(value)) {
    issues.push({ field, message: "must be a non-empty string" });
    return;
  }
  if (value.length > maxLength) {
    issues.push({ field, message: `must be at most ${maxLength} characters` });
  }
}

function requireOptionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  issues: OptimizationValidationIssue[],
): void {
  if (value !== null && value !== undefined && typeof value !== "string") {
    issues.push({ field, message: "must be a string or null" });
    return;
  }
  if (typeof value === "string" && value.length > maxLength) {
    issues.push({ field, message: `must be at most ${maxLength} characters` });
  }
}

function requireDate(
  value: unknown,
  field: string,
  issues: OptimizationValidationIssue[],
): void {
  if (!date(value)) issues.push({ field, message: "must be an ISO date-time" });
}

function requireEnum(
  value: unknown,
  allowed: readonly string[],
  field: string,
  issues: OptimizationValidationIssue[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
  }
}

function validateMetricValue(
  value: unknown,
  field: string,
): OptimizationValidationIssue[] {
  if (!record(value)) return [{ field, message: "must be an object" }];
  const issues = keys(value, ["status", "value", "reason"], field);
  if (value.status === "available") {
    if (!nonNegativeNumber(value.value)) {
      issues.push({
        field: `${field}.value`,
        message: "must be finite and non-negative",
      });
    }
    if ("reason" in value) {
      issues.push({
        field: `${field}.reason`,
        message: "must be absent when available",
      });
    }
  } else if (value.status === "unavailable") {
    requireEnum(
      value.reason,
      PERFORMANCE_UNAVAILABLE_REASONS,
      `${field}.reason`,
      issues,
    );
    if ("value" in value) {
      issues.push({
        field: `${field}.value`,
        message: "must be absent when unavailable",
      });
    }
  } else {
    issues.push({
      field: `${field}.status`,
      message: "must be available or unavailable",
    });
  }
  return issues;
}

function validateMetrics(
  value: unknown,
  field: string,
): OptimizationValidationIssue[] {
  if (!record(value)) return [{ field, message: "must be an object" }];
  const issues = keys(value, OPTIMIZATION_REQUIRED_METRICS, field);
  for (const metric of OPTIMIZATION_REQUIRED_METRICS) {
    if (!(metric in value)) {
      issues.push({ field: `${field}.${metric}`, message: "is required" });
      continue;
    }
    issues.push(...validateMetricValue(value[metric], `${field}.${metric}`));
  }
  return issues;
}

function validateIdentity(
  value: Record<string, unknown>,
  field: string,
  issues: OptimizationValidationIssue[],
): void {
  requireUuid(value.business_id, `${field}.business_id`, issues);
  requireUuid(value.strategy_id, `${field}.strategy_id`, issues);
  if (!integer(value.strategy_version) || Number(value.strategy_version) < 1) {
    issues.push({
      field: `${field}.strategy_version`,
      message: "must be a positive integer",
    });
  }
  requireUuid(value.content_cycle_id, `${field}.content_cycle_id`, issues);
}

function validateComparison(
  value: unknown,
  field: string,
): OptimizationValidationIssue[] {
  if (!record(value)) return [{ field, message: "must be an object" }];
  const issues = keys(
    value,
    [
      "metric",
      "baseline_median",
      "values",
      "best_snapshot_id",
      "best_value",
      "delta_from_median",
      "delta_percent",
      "direction",
    ],
    field,
  );
  requireEnum(
    value.metric,
    OPTIMIZATION_REQUIRED_METRICS,
    `${field}.metric`,
    issues,
  );
  if (!nonNegativeNumber(value.baseline_median)) {
    issues.push({
      field: `${field}.baseline_median`,
      message: "must be finite and non-negative",
    });
  }
  if (
    !Array.isArray(value.values) ||
    value.values.length === 0 ||
    value.values.some((item) => !nonNegativeNumber(item))
  ) {
    issues.push({
      field: `${field}.values`,
      message: "must contain finite non-negative numbers",
    });
  }
  requireUuid(value.best_snapshot_id, `${field}.best_snapshot_id`, issues);
  if (!nonNegativeNumber(value.best_value)) {
    issues.push({
      field: `${field}.best_value`,
      message: "must be finite and non-negative",
    });
  }
  if (!number(value.delta_from_median)) {
    issues.push({
      field: `${field}.delta_from_median`,
      message: "must be finite",
    });
  }
  if (value.delta_percent !== null && !number(value.delta_percent)) {
    issues.push({
      field: `${field}.delta_percent`,
      message: "must be finite or null",
    });
  }
  requireEnum(
    value.direction,
    ["higher_is_better"],
    `${field}.direction`,
    issues,
  );
  return issues;
}

function closeEnough(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function numericMedian(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function validateGenerationConsistency(
  value: Record<string, unknown>,
  issues: OptimizationValidationIssue[],
): void {
  if (!record(value.identity) || !Array.isArray(value.evidence)) return;
  const identity = value.identity;
  const evidence = value.evidence;

  const evidenceIds = new Set<string>();
  const evidenceValues = new Map<string, number[]>();
  for (const metric of OPTIMIZATION_REQUIRED_METRICS)
    evidenceValues.set(metric, []);

  evidence.forEach((item, index) => {
    if (!record(item)) return;
    if (typeof item.snapshot_id === "string") {
      if (evidenceIds.has(item.snapshot_id)) {
        issues.push({
          field: `request.evidence[${index}].snapshot_id`,
          message: "must be unique within the evidence set",
        });
      }
      evidenceIds.add(item.snapshot_id);
    }
    if (item.content_format !== identity.format_cohort) {
      issues.push({
        field: `request.evidence[${index}].content_format`,
        message: "must match request.identity.format_cohort",
      });
    }
    if (!record(item.metrics)) return;
    for (const metric of OPTIMIZATION_REQUIRED_METRICS) {
      const metricValue = item.metrics[metric];
      if (
        !record(metricValue) ||
        metricValue.status !== "available" ||
        !nonNegativeNumber(metricValue.value)
      ) {
        issues.push({
          field: `request.evidence[${index}].metrics.${metric}`,
          message: "must be available for an eligible generation request",
        });
        continue;
      }
      evidenceValues.get(metric)?.push(metricValue.value);
    }
  });

  if (!Array.isArray(value.deterministic_comparison)) return;
  const metrics = value.deterministic_comparison.map((item) =>
    record(item) ? item.metric : null,
  );
  if (
    metrics.length !== OPTIMIZATION_REQUIRED_METRICS.length ||
    metrics.some(
      (metric, index) => metric !== OPTIMIZATION_REQUIRED_METRICS[index],
    )
  ) {
    issues.push({
      field: "request.deterministic_comparison",
      message: "must contain the frozen metric set in canonical order",
    });
    return;
  }

  value.deterministic_comparison.forEach((item, index) => {
    if (!record(item) || typeof item.metric !== "string") return;
    const expectedValues = evidenceValues.get(item.metric) ?? [];
    if (
      !Array.isArray(item.values) ||
      item.values.length !== expectedValues.length ||
      item.values.some(
        (observation, valueIndex) =>
          !number(observation) ||
          !closeEnough(observation, expectedValues[valueIndex]),
      )
    ) {
      issues.push({
        field: `request.deterministic_comparison[${index}].values`,
        message: "must match the prepared evidence values in canonical order",
      });
      return;
    }
    if (expectedValues.length === 0) return;
    const expectedMedian = numericMedian(expectedValues);
    const expectedBest = Math.max(...expectedValues);
    const expectedDelta = expectedBest - expectedMedian;
    const expectedPercent =
      expectedMedian > 0 ? (expectedDelta / expectedMedian) * 100 : null;
    if (
      !number(item.baseline_median) ||
      !closeEnough(item.baseline_median, expectedMedian)
    )
      issues.push({
        field: `request.deterministic_comparison[${index}].baseline_median`,
        message: "must equal the deterministic median",
      });
    if (!number(item.best_value) || !closeEnough(item.best_value, expectedBest))
      issues.push({
        field: `request.deterministic_comparison[${index}].best_value`,
        message: "must equal the best observed value",
      });
    if (
      !number(item.delta_from_median) ||
      !closeEnough(item.delta_from_median, expectedDelta)
    )
      issues.push({
        field: `request.deterministic_comparison[${index}].delta_from_median`,
        message: "must equal best value minus median",
      });
    if (
      (expectedPercent === null && item.delta_percent !== null) ||
      (expectedPercent !== null &&
        (!number(item.delta_percent) ||
          !closeEnough(item.delta_percent, expectedPercent)))
    )
      issues.push({
        field: `request.deterministic_comparison[${index}].delta_percent`,
        message: "must equal the deterministic percentage delta",
      });

    const eligibleBestIds = evidence
      .filter((evidenceItem, evidenceIndex) => {
        if (!record(evidenceItem)) return false;
        return closeEnough(expectedValues[evidenceIndex], expectedBest);
      })
      .map((evidenceItem) =>
        record(evidenceItem) && typeof evidenceItem.snapshot_id === "string"
          ? evidenceItem.snapshot_id
          : "",
      )
      .filter(Boolean)
      .sort();
    if (item.best_snapshot_id !== eligibleBestIds[0])
      issues.push({
        field: `request.deterministic_comparison[${index}].best_snapshot_id`,
        message: "must identify the canonical best evidence snapshot",
      });
  });
}

function validateGeneratedPolicy(
  value: unknown,
  field: string,
  issues: OptimizationValidationIssue[],
): void {
  if (typeof value !== "string") return;
  const withoutSafeClaims = value
    .replace(
      /\b(?:does\s+not|doesn't|cannot|can't|is\s+not|not)\s+(?:guarantee|prove|cause|establish)\b/gi,
      "",
    )
    .replace(/\b(?:not|is\s+not|isn't)\s+statistically\s+significant\b/gi, "")
    .replace(/(?:لا|لن)\s+(?:يضمن|يثبت|يسبب|يزيد)/gu, "")
    .replace(/غير\s+مضمون(?:ة)?|ليست?\s+ذات\s+دلالة\s+إحصائية/gu, "");
  if (
    UNSUPPORTED_CLAIM_PATTERNS.some((pattern) =>
      pattern.test(withoutSafeClaims),
    )
  ) {
    issues.push({
      field,
      message:
        "must describe an observed association without causal, guaranteed, or universal claims",
    });
  }

  const withoutSafeScopeStatements = value
    .replace(
      /\b(?:do\s+not|don't|never|without)\s+(?:change|switch|replace|alter|reschedule|move|set|increase|decrease)\b.{0,80}\b(?:strategy|goal|topic|purpose|audience|channel|locale|format|post\s+count|media|asset|publishing\s+(?:date|time|window)|schedule|offer|business\s+facts?|created\s+content)\b/gi,
      "",
    )
    .replace(
      /(?:لا|دون)\s+(?:تغي[ّ]?ر|تبد[ّ]?ل|تعد[ّ]?ل).{0,80}(?:الاستراتيجية|الهدف|الموضوع|الغرض|الجمهور|القناة|اللغة|التنسيق|عدد\s+المنشورات|الوسائط|موعد\s+النشر|وقت\s+النشر|الجدول|العرض|حقائق\s+النشاط|المحتوى\s+المنشأ)/gu,
      "",
    );
  if (
    PROHIBITED_SCOPE_DIRECTIVE.test(withoutSafeScopeStatements) ||
    PROHIBITED_SCOPE_DIRECTIVE_AR.test(withoutSafeScopeStatements)
  ) {
    issues.push({
      field,
      message: "must not direct a change outside hook or CTA wording",
    });
  }
}

function validateEvidence(
  value: unknown,
  field: string,
  generation: boolean,
): OptimizationValidationIssue[] {
  if (!record(value)) return [{ field, message: "must be an object" }];
  const allowed = generation
    ? [
        "snapshot_id",
        "candidate_id",
        "content_format",
        "published_at",
        "metrics",
        "untrusted_caption",
        "untrusted_cta",
      ]
    : [
        "snapshot_id",
        "business_id",
        "publishing_result_id",
        "candidate_id",
        "candidate_checksum",
        "strategy_id",
        "strategy_version",
        "content_cycle_id",
        "content_format",
        "provider",
        "window",
        "published_at",
        "observed_at",
        "metrics",
        "caption",
        "cta",
      ];
  const issues = keys(value, allowed, field);
  requireUuid(value.snapshot_id, `${field}.snapshot_id`, issues);
  requireUuid(value.candidate_id, `${field}.candidate_id`, issues);
  requireEnum(
    value.content_format,
    OPTIMIZATION_FORMATS,
    `${field}.content_format`,
    issues,
  );
  requireDate(value.published_at, `${field}.published_at`, issues);
  issues.push(...validateMetrics(value.metrics, `${field}.metrics`));
  if (generation) {
    requireBoundedString(
      value.untrusted_caption,
      `${field}.untrusted_caption`,
      OPTIMIZATION_MAX_UNTRUSTED_TEXT_LENGTH,
      issues,
    );
    if (!("untrusted_cta" in value)) {
      issues.push({
        field: `${field}.untrusted_cta`,
        message: "is required, even when null",
      });
    } else {
      requireOptionalBoundedString(
        value.untrusted_cta,
        `${field}.untrusted_cta`,
        OPTIMIZATION_MAX_UNTRUSTED_TEXT_LENGTH,
        issues,
      );
    }
  } else {
    validateIdentity(value, field, issues);
    requireUuid(
      value.publishing_result_id,
      `${field}.publishing_result_id`,
      issues,
    );
    requireString(
      value.candidate_checksum,
      `${field}.candidate_checksum`,
      issues,
    );
    if (value.provider !== "facebook")
      issues.push({ field: `${field}.provider`, message: "must be facebook" });
    requireEnum(value.window, ["7d"], `${field}.window`, issues);
    requireDate(value.observed_at, `${field}.observed_at`, issues);
    requireBoundedString(
      value.caption,
      `${field}.caption`,
      OPTIMIZATION_MAX_UNTRUSTED_TEXT_LENGTH,
      issues,
    );
    if (!("cta" in value)) {
      issues.push({
        field: `${field}.cta`,
        message: "is required, even when null",
      });
    } else {
      requireOptionalBoundedString(
        value.cta,
        `${field}.cta`,
        OPTIMIZATION_MAX_UNTRUSTED_TEXT_LENGTH,
        issues,
      );
    }
  }
  return issues;
}

export function validateOptimizationReadinessV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value))
    return {
      valid: false,
      issues: [{ field: "readiness", message: "must be an object" }],
    };
  issues.push(
    ...keys(
      value,
      [
        "contract_version",
        "status",
        "business_id",
        "format_cohort",
        "eligible_post_count",
        "required_post_count",
        "required_metrics",
        "available_formats",
        "reason",
      ],
      "readiness",
    ),
  );
  if (value.contract_version !== OPTIMIZATION_CONTRACT_VERSION)
    issues.push({
      field: "readiness.contract_version",
      message: "must be optimization-v1",
    });
  requireEnum(
    value.status,
    OPTIMIZATION_READINESS_STATUSES,
    "readiness.status",
    issues,
  );
  requireUuid(value.business_id, "readiness.business_id", issues);
  if (value.format_cohort !== null && value.format_cohort !== undefined)
    requireEnum(
      value.format_cohort,
      OPTIMIZATION_FORMATS,
      "readiness.format_cohort",
      issues,
    );
  if (
    !integer(value.eligible_post_count) ||
    Number(value.eligible_post_count) < 0
  )
    issues.push({
      field: "readiness.eligible_post_count",
      message: "must be a non-negative integer",
    });
  if (value.required_post_count !== OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT)
    issues.push({
      field: "readiness.required_post_count",
      message: "must be three",
    });
  if (
    !Array.isArray(value.required_metrics) ||
    value.required_metrics.join(",") !== OPTIMIZATION_REQUIRED_METRICS.join(",")
  )
    issues.push({
      field: "readiness.required_metrics",
      message: "must contain the frozen required metrics",
    });
  if (
    !Array.isArray(value.available_formats) ||
    value.available_formats.some(
      (format) =>
        !OPTIMIZATION_FORMATS.includes(
          format as (typeof OPTIMIZATION_FORMATS)[number],
        ),
    )
  )
    issues.push({
      field: "readiness.available_formats",
      message: "must contain content formats",
    });
  if (value.reason !== null)
    requireEnum(
      value.reason,
      OPTIMIZATION_READINESS_REASONS,
      "readiness.reason",
      issues,
    );
  return { valid: issues.length === 0, issues };
}

export function validateOptimizationGenerationRequestV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value))
    return {
      valid: false,
      issues: [{ field: "request", message: "must be an object" }],
    };
  issues.push(
    ...keys(
      value,
      [
        "contract_version",
        "generation_fingerprint",
        "evidence_checksum",
        "identity",
        "evidence",
        "deterministic_comparison",
        "allowed_change_kinds",
        "prohibited_changes",
      ],
      "request",
    ),
  );
  if (value.contract_version !== OPTIMIZATION_CONTRACT_VERSION)
    issues.push({
      field: "request.contract_version",
      message: "must be optimization-v1",
    });
  requireChecksum(
    value.generation_fingerprint,
    "request.generation_fingerprint",
    issues,
  );
  requireChecksum(value.evidence_checksum, "request.evidence_checksum", issues);
  if (!record(value.identity))
    issues.push({ field: "request.identity", message: "must be an object" });
  else {
    issues.push(
      ...keys(
        value.identity,
        [
          "business_id",
          "strategy_id",
          "strategy_version",
          "content_cycle_id",
          "format_cohort",
        ],
        "request.identity",
      ),
    );
    validateIdentity(value.identity, "request.identity", issues);
    requireEnum(
      value.identity.format_cohort,
      OPTIMIZATION_FORMATS,
      "request.identity.format_cohort",
      issues,
    );
  }
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length < OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT
  )
    issues.push({
      field: "request.evidence",
      message: "must contain at least three entries",
    });
  else
    value.evidence.forEach((item, index) =>
      issues.push(
        ...validateEvidence(item, `request.evidence[${index}]`, true),
      ),
    );
  if (
    !Array.isArray(value.deterministic_comparison) ||
    value.deterministic_comparison.length === 0
  )
    issues.push({
      field: "request.deterministic_comparison",
      message: "must contain comparisons",
    });
  else
    value.deterministic_comparison.forEach((item, index) =>
      issues.push(
        ...validateComparison(
          item,
          `request.deterministic_comparison[${index}]`,
        ),
      ),
    );
  if (
    !Array.isArray(value.allowed_change_kinds) ||
    value.allowed_change_kinds.length === 0
  )
    issues.push({
      field: "request.allowed_change_kinds",
      message: "must not be empty",
    });
  else
    value.allowed_change_kinds.forEach((kind, index) =>
      requireEnum(
        kind,
        OPTIMIZATION_CHANGE_KINDS,
        `request.allowed_change_kinds[${index}]`,
        issues,
      ),
    );
  if (
    !Array.isArray(value.prohibited_changes) ||
    value.prohibited_changes.some((item) => !string(item))
  )
    issues.push({
      field: "request.prohibited_changes",
      message: "must contain non-empty strings",
    });
  else if (
    value.prohibited_changes.length !==
      OPTIMIZATION_PROHIBITED_CHANGES.length ||
    value.prohibited_changes.some(
      (item, index) => item !== OPTIMIZATION_PROHIBITED_CHANGES[index],
    )
  )
    issues.push({
      field: "request.prohibited_changes",
      message: "must contain the frozen prohibited-change set",
    });
  validateGenerationConsistency(value, issues);
  return { valid: issues.length === 0, issues };
}

export function validateOptimizationAgentResultV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value))
    return {
      valid: false,
      issues: [{ field: "result", message: "must be an object" }],
    };
  const common = [
    "contract_version",
    "outcome",
    "generation_fingerprint",
    "model_version",
    "prompt_version",
  ];
  issues.push(
    ...keys(
      value,
      value.outcome === "recommendation"
        ? [
            ...common,
            "evidence_snapshot_ids",
            "change_kind",
            "summary",
            "rationale",
            "uncertainty",
            "instruction",
          ]
        : [...common, "reason"],
      "result",
    ),
  );
  if (value.contract_version !== OPTIMIZATION_CONTRACT_VERSION)
    issues.push({
      field: "result.contract_version",
      message: "must be optimization-v1",
    });
  requireEnum(
    value.outcome,
    ["recommendation", "no_recommendation"],
    "result.outcome",
    issues,
  );
  requireChecksum(
    value.generation_fingerprint,
    "result.generation_fingerprint",
    issues,
  );
  requireString(value.model_version, "result.model_version", issues);
  requireEnum(
    value.prompt_version,
    [OPTIMIZATION_PROMPT_VERSION],
    "result.prompt_version",
    issues,
  );
  if (value.outcome === "recommendation") {
    if (
      !Array.isArray(value.evidence_snapshot_ids) ||
      value.evidence_snapshot_ids.length < OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT
    )
      issues.push({
        field: "result.evidence_snapshot_ids",
        message: "must contain at least three snapshot IDs",
      });
    else
      value.evidence_snapshot_ids.forEach((id, index) =>
        requireUuid(id, `result.evidence_snapshot_ids[${index}]`, issues),
      );
    requireEnum(
      value.change_kind,
      OPTIMIZATION_CHANGE_KINDS,
      "result.change_kind",
      issues,
    );
    for (const field of [
      "summary",
      "rationale",
      "uncertainty",
      "instruction",
    ]) {
      requireBoundedString(
        value[field],
        `result.${field}`,
        OPTIMIZATION_MAX_GENERATED_TEXT_LENGTH,
        issues,
      );
      validateGeneratedPolicy(value[field], `result.${field}`, issues);
    }
  } else if (value.outcome === "no_recommendation") {
    requireEnum(
      value.reason,
      OPTIMIZATION_NO_RECOMMENDATION_REASONS,
      "result.reason",
      issues,
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validateOptimizationProposalV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value))
    return {
      valid: false,
      issues: [{ field: "proposal", message: "must be an object" }],
    };
  issues.push(
    ...keys(
      value,
      [
        "contract_version",
        "proposal_id",
        "business_id",
        "strategy_id",
        "strategy_version",
        "content_cycle_id",
        "format_cohort",
        "basis_snapshot_ids",
        "evidence_checksum",
        "deterministic_comparison",
        "change_kind",
        "summary",
        "rationale",
        "uncertainty",
        "instruction",
        "model_version",
        "prompt_version",
        "generation_fingerprint",
        "status",
        "created_at",
      ],
      "proposal",
    ),
  );
  if (value.contract_version !== OPTIMIZATION_CONTRACT_VERSION)
    issues.push({
      field: "proposal.contract_version",
      message: "must be optimization-v1",
    });
  requireUuid(value.proposal_id, "proposal.proposal_id", issues);
  validateIdentity(value, "proposal", issues);
  requireEnum(
    value.format_cohort,
    OPTIMIZATION_FORMATS,
    "proposal.format_cohort",
    issues,
  );
  if (
    !Array.isArray(value.basis_snapshot_ids) ||
    value.basis_snapshot_ids.length < OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT
  )
    issues.push({
      field: "proposal.basis_snapshot_ids",
      message: "must contain at least three snapshot IDs",
    });
  else
    value.basis_snapshot_ids.forEach((id, index) =>
      requireUuid(id, `proposal.basis_snapshot_ids[${index}]`, issues),
    );
  requireChecksum(
    value.evidence_checksum,
    "proposal.evidence_checksum",
    issues,
  );
  if (
    !Array.isArray(value.deterministic_comparison) ||
    value.deterministic_comparison.length === 0
  )
    issues.push({
      field: "proposal.deterministic_comparison",
      message: "must contain comparisons",
    });
  else
    value.deterministic_comparison.forEach((item, index) =>
      issues.push(
        ...validateComparison(
          item,
          `proposal.deterministic_comparison[${index}]`,
        ),
      ),
    );
  requireEnum(
    value.change_kind,
    OPTIMIZATION_CHANGE_KINDS,
    "proposal.change_kind",
    issues,
  );
  for (const field of ["summary", "rationale", "uncertainty", "instruction"]) {
    requireBoundedString(
      value[field],
      `proposal.${field}`,
      OPTIMIZATION_MAX_GENERATED_TEXT_LENGTH,
      issues,
    );
    validateGeneratedPolicy(value[field], `proposal.${field}`, issues);
  }
  requireString(value.model_version, "proposal.model_version", issues);
  requireEnum(
    value.prompt_version,
    [OPTIMIZATION_PROMPT_VERSION],
    "proposal.prompt_version",
    issues,
  );
  requireChecksum(
    value.generation_fingerprint,
    "proposal.generation_fingerprint",
    issues,
  );
  if (value.status !== "PENDING_OWNER_DECISION")
    issues.push({
      field: "proposal.status",
      message: "must be PENDING_OWNER_DECISION in optimization-v1",
    });
  requireDate(value.created_at, "proposal.created_at", issues);
  return { valid: issues.length === 0, issues };
}

export function validateOptimizationDecisionV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value)) {
    return {
      valid: false,
      issues: [{ field: "decision", message: "must be an object" }],
    };
  }
  issues.push(
    ...keys(
      value,
      [
        "contract_version",
        "decision_id",
        "proposal_id",
        "business_id",
        "strategy_id",
        "strategy_version",
        "content_cycle_id",
        "format_cohort",
        "evidence_checksum",
        "action",
        "owner_user_id",
        "request_fingerprint",
        "note",
        "decided_at",
      ],
      "decision",
    ),
  );
  if (value.contract_version !== OPTIMIZATION_DECISION_CONTRACT_VERSION)
    issues.push({
      field: "decision.contract_version",
      message: "must be optimization-decision-v1",
    });
  requireUuid(value.decision_id, "decision.decision_id", issues);
  requireUuid(value.proposal_id, "decision.proposal_id", issues);
  validateIdentity(value, "decision", issues);
  requireEnum(
    value.format_cohort,
    OPTIMIZATION_FORMATS,
    "decision.format_cohort",
    issues,
  );
  requireChecksum(
    value.evidence_checksum,
    "decision.evidence_checksum",
    issues,
  );
  requireEnum(
    value.action,
    OPTIMIZATION_DECISION_ACTIONS,
    "decision.action",
    issues,
  );
  requireUuid(value.owner_user_id, "decision.owner_user_id", issues);
  requireChecksum(
    value.request_fingerprint,
    "decision.request_fingerprint",
    issues,
  );
  if (value.note !== null) {
    requireOptionalBoundedString(value.note, "decision.note", 1_000, issues);
  }
  requireDate(value.decided_at, "decision.decided_at", issues);
  return { valid: issues.length === 0, issues };
}

export function validateApprovedOptimizationInstructionV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value)) {
    return {
      valid: false,
      issues: [{ field: "instruction", message: "must be an object" }],
    };
  }
  issues.push(
    ...keys(
      value,
      [
        "contract_version",
        "instruction_id",
        "proposal_id",
        "approved_decision_id",
        "business_id",
        "strategy_id",
        "strategy_version",
        "content_cycle_id",
        "format_cohort",
        "evidence_checksum",
        "change_kind",
        "instruction",
        "status",
        "consumed_content_pack_id",
        "consumed_week_plan_id",
        "approved_at",
        "consumed_at",
        "superseded_at",
        "created_at",
        "updated_at",
      ],
      "instruction",
    ),
  );
  if (value.contract_version !== OPTIMIZATION_INSTRUCTION_CONTRACT_VERSION)
    issues.push({
      field: "instruction.contract_version",
      message: "must be optimization-instruction-v1",
    });
  requireUuid(value.instruction_id, "instruction.instruction_id", issues);
  requireUuid(value.proposal_id, "instruction.proposal_id", issues);
  requireUuid(
    value.approved_decision_id,
    "instruction.approved_decision_id",
    issues,
  );
  validateIdentity(value, "instruction", issues);
  requireEnum(
    value.format_cohort,
    OPTIMIZATION_FORMATS,
    "instruction.format_cohort",
    issues,
  );
  requireChecksum(
    value.evidence_checksum,
    "instruction.evidence_checksum",
    issues,
  );
  requireEnum(
    value.change_kind,
    OPTIMIZATION_CHANGE_KINDS,
    "instruction.change_kind",
    issues,
  );
  requireBoundedString(
    value.instruction,
    "instruction.instruction",
    OPTIMIZATION_MAX_GENERATED_TEXT_LENGTH,
    issues,
  );
  validateGeneratedPolicy(value.instruction, "instruction.instruction", issues);
  requireEnum(
    value.status,
    OPTIMIZATION_INSTRUCTION_STATUSES,
    "instruction.status",
    issues,
  );
  for (const field of ["consumed_content_pack_id", "consumed_week_plan_id"]) {
    if (value[field] !== null)
      requireUuid(value[field], `instruction.${field}`, issues);
  }
  for (const field of ["approved_at", "created_at", "updated_at"]) {
    requireDate(value[field], `instruction.${field}`, issues);
  }
  for (const field of ["consumed_at", "superseded_at"]) {
    if (value[field] !== null)
      requireDate(value[field], `instruction.${field}`, issues);
  }
  if (value.status === "PENDING_CONSUMPTION") {
    if (
      value.consumed_content_pack_id !== null ||
      value.consumed_week_plan_id !== null ||
      value.consumed_at !== null ||
      value.superseded_at !== null
    ) {
      issues.push({
        field: "instruction",
        message: "pending instructions cannot have consumption provenance",
      });
    }
  }
  if (value.status === "CONSUMED") {
    if (
      value.consumed_content_pack_id === null ||
      value.consumed_week_plan_id === null ||
      value.consumed_at === null ||
      value.superseded_at !== null
    ) {
      issues.push({
        field: "instruction",
        message:
          "consumed instructions require pack, week-plan, and timestamp provenance",
      });
    }
  }
  if (value.status === "SUPERSEDED" || value.status === "EXPIRED") {
    if (
      value.consumed_content_pack_id !== null ||
      value.consumed_week_plan_id !== null ||
      value.consumed_at !== null ||
      value.superseded_at === null
    ) {
      issues.push({
        field: "instruction",
        message:
          "superseded or expired instructions require terminal provenance",
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

export function validateOptimizationProposalWorkspaceV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value)) {
    return {
      valid: false,
      issues: [{ field: "workspace", message: "must be an object" }],
    };
  }
  issues.push(
    ...keys(
      value,
      ["contract_version", "proposal", "state", "decision", "instruction"],
      "workspace",
    ),
  );
  if (value.contract_version !== OPTIMIZATION_CONTRACT_VERSION)
    issues.push({
      field: "workspace.contract_version",
      message: "must be optimization-v1",
    });
  const proposalResult = validateOptimizationProposalV1(value.proposal);
  issues.push(...proposalResult.issues);
  requireEnum(
    value.state,
    OPTIMIZATION_PROPOSAL_WORKSPACE_STATES,
    "workspace.state",
    issues,
  );
  if (value.decision !== null) {
    const decisionResult = validateOptimizationDecisionV1(value.decision);
    issues.push(...decisionResult.issues);
    if (
      record(value.proposal) &&
      record(value.decision) &&
      (value.decision.proposal_id !== value.proposal.proposal_id ||
        value.decision.business_id !== value.proposal.business_id ||
        value.decision.strategy_id !== value.proposal.strategy_id ||
        value.decision.strategy_version !== value.proposal.strategy_version ||
        value.decision.content_cycle_id !== value.proposal.content_cycle_id ||
        value.decision.format_cohort !== value.proposal.format_cohort ||
        value.decision.evidence_checksum !== value.proposal.evidence_checksum)
    ) {
      issues.push({
        field: "workspace.decision",
        message: "must remain bound to the immutable proposal identity",
      });
    }
  }
  if (value.instruction !== null) {
    const instructionResult = validateApprovedOptimizationInstructionV1(
      value.instruction,
    );
    issues.push(...instructionResult.issues);
    if (record(value.proposal) && record(value.instruction)) {
      if (
        value.instruction.proposal_id !== value.proposal.proposal_id ||
        value.instruction.business_id !== value.proposal.business_id ||
        value.instruction.strategy_id !== value.proposal.strategy_id ||
        value.instruction.strategy_version !==
          value.proposal.strategy_version ||
        value.instruction.content_cycle_id !==
          value.proposal.content_cycle_id ||
        value.instruction.format_cohort !== value.proposal.format_cohort ||
        value.instruction.evidence_checksum !==
          value.proposal.evidence_checksum ||
        value.instruction.change_kind !== value.proposal.change_kind ||
        value.instruction.instruction !== value.proposal.instruction
      ) {
        issues.push({
          field: "workspace.instruction",
          message: "must remain bound to the immutable proposal identity",
        });
      }
      if (!record(value.decision) || value.decision.action !== "approve") {
        issues.push({
          field: "workspace.instruction",
          message: "requires an approved owner decision",
        });
      } else if (
        value.instruction.approved_decision_id !== value.decision.decision_id
      ) {
        issues.push({
          field: "workspace.instruction.approved_decision_id",
          message: "must reference the workspace decision",
        });
      }
    }
  }
  if (record(value.decision)) {
    if (value.decision.action === "approve" && value.instruction === null) {
      issues.push({
        field: "workspace.instruction",
        message: "an approved decision requires one instruction",
      });
    }
    if (value.decision.action === "dismiss" && value.instruction !== null) {
      issues.push({
        field: "workspace.instruction",
        message: "a dismissed decision cannot carry an instruction",
      });
    }
  }
  const decisionRecord = record(value.decision) ? value.decision : null;
  const instructionRecord = record(value.instruction)
    ? value.instruction
    : null;
  const expectedState =
    decisionRecord === null
      ? "PENDING_OWNER_DECISION"
      : decisionRecord.action === "dismiss"
        ? "DISMISSED"
        : instructionRecord?.status === "CONSUMED"
          ? "CONSUMED"
          : instructionRecord?.status === "SUPERSEDED"
            ? "SUPERSEDED"
            : instructionRecord?.status === "EXPIRED"
              ? "EXPIRED"
              : "APPROVED_PENDING_CONSUMPTION";
  if (value.state !== expectedState) {
    issues.push({
      field: "workspace.state",
      message: "must reflect the terminal decision and instruction status",
    });
  }
  return { valid: issues.length === 0, issues };
}

export function validateOptimizationDecisionResponseV1(
  value: unknown,
): OptimizationValidationResult {
  const issues: OptimizationValidationIssue[] = [];
  if (!record(value)) {
    return {
      valid: false,
      issues: [{ field: "decision_response", message: "must be an object" }],
    };
  }
  issues.push(
    ...keys(value, ["contract_version", "workspace"], "decision_response"),
  );
  if (value.contract_version !== OPTIMIZATION_DECISION_CONTRACT_VERSION) {
    issues.push({
      field: "decision_response.contract_version",
      message: "must be optimization-decision-v1",
    });
  }
  issues.push(
    ...validateOptimizationProposalWorkspaceV1(value.workspace).issues,
  );
  return { valid: issues.length === 0, issues };
}

export function assertValidOptimizationProposalV1(
  value: unknown,
): asserts value is OptimizationProposalV1 {
  const result = validateOptimizationProposalV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function assertValidOptimizationDecisionV1(
  value: unknown,
): asserts value is OptimizationDecisionV1 {
  const result = validateOptimizationDecisionV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function assertValidApprovedOptimizationInstructionV1(
  value: unknown,
): asserts value is ApprovedOptimizationInstructionV1 {
  const result = validateApprovedOptimizationInstructionV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function assertValidOptimizationProposalWorkspaceV1(
  value: unknown,
): asserts value is OptimizationProposalWorkspaceV1 {
  const result = validateOptimizationProposalWorkspaceV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function assertValidOptimizationDecisionResponseV1(
  value: unknown,
): asserts value is OptimizationDecisionResponseV1 {
  const result = validateOptimizationDecisionResponseV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}

export function assertValidOptimizationAgentResultV1(
  value: unknown,
): asserts value is OptimizationAgentResultV1 {
  const result = validateOptimizationAgentResultV1(value);
  if (!result.valid)
    throw new Error(
      result.issues.map((item) => `${item.field}: ${item.message}`).join("; "),
    );
}
