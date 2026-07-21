/**
 * Controlled vocabulary for the marketing knowledge library.
 *
 * These constants are the single source of truth for the application-layer
 * validation of taxonomy fields. The scalar fields (`kind`, `locale`,
 * `evidence_tier`, `review_status`, ingestion-run `status`) are ALSO enforced
 * at the database layer via `CHECK` constraints — see
 * `apps/api/prisma/migrations/.../migration.sql`. The array-element fields
 * (`markets`, `industries`, `objectives`, `funnel_stages`, `channels`,
 * `seasons`, `budget_modes`, `business_models`) are enforced here only,
 * because a raw Postgres `CHECK` over array contents would need a helper
 * function; ingestion code must therefore never skip this validation and
 * trust the DB alone.
 *
 * The values are kept byte-identical to `packages/contracts` and to
 * `services/ai/app/qdrant/schemas.py` — lowercase snake_case string literals
 * with no enum-casing translation layer (matching the repo convention for
 * status/lifecycle fields).
 */

export const KNOWLEDGE_KINDS = [
  "framework",
  "objective_playbook",
  "channel_playbook",
  "benchmark_report",
  "content_strategy_playbook",
  "budget_playbook",
  "measurement_playbook",
  "regional_guidance",
  "sector_note",
  "policy",
] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_LOCALES = ["ar-EG", "en", "mixed"] as const;
export type KnowledgeLocale = (typeof KNOWLEDGE_LOCALES)[number];

export const KNOWLEDGE_MARKETS = ["egypt", "mena", "global"] as const;
export type KnowledgeMarket = (typeof KNOWLEDGE_MARKETS)[number];

export const KNOWLEDGE_INDUSTRIES = [
  "retail",
  "hospitality",
  "services",
  "education",
  "healthcare",
  "general",
] as const;
export type KnowledgeIndustry = (typeof KNOWLEDGE_INDUSTRIES)[number];

// `business_models` has NO fixed controlled vocabulary in the merged
// contracts or in the issue taxonomy (plan §4 omits it on purpose). It is
// stored as a free-form slug array and validated only for slug shape at the
// application layer; do NOT invent a restrictive allowed set here.
export const KNOWLEDGE_OBJECTIVES = [
  "awareness",
  "acquisition",
  "conversion",
  "retention",
  "launch",
] as const;
export type KnowledgeObjective = (typeof KNOWLEDGE_OBJECTIVES)[number];

export const KNOWLEDGE_FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "conversion",
  "retention",
  "advocacy",
] as const;
export type KnowledgeFunnelStage = (typeof KNOWLEDGE_FUNNEL_STAGES)[number];

export const KNOWLEDGE_CHANNELS = [
  "facebook",
  "instagram",
  "tiktok",
  "google_business_profile",
  "website",
  "delivery_platforms",
] as const;
export type KnowledgeChannel = (typeof KNOWLEDGE_CHANNELS)[number];

export const KNOWLEDGE_SEASONS = [
  "ramadan",
  "eid_al_fitr",
  "eid_al_adha",
  "back_to_school",
  "summer",
  "winter_holidays",
] as const;
export type KnowledgeSeason = (typeof KNOWLEDGE_SEASONS)[number];

export const KNOWLEDGE_BUDGET_MODES = [
  "organic_only",
  "monthly_amount",
  "three_month_amount",
  "scenario_only",
] as const;
export type KnowledgeBudgetMode = (typeof KNOWLEDGE_BUDGET_MODES)[number];

export const KNOWLEDGE_EVIDENCE_TIERS = [
  "verified_benchmark",
  "reviewed_guidance",
  "contextual_note",
] as const;
export type KnowledgeEvidenceTier = (typeof KNOWLEDGE_EVIDENCE_TIERS)[number];

export const KNOWLEDGE_REVIEW_STATUSES = [
  "draft",
  "approved",
  "retired",
  "expired",
] as const;
export type KnowledgeReviewStatus = (typeof KNOWLEDGE_REVIEW_STATUSES)[number];

export const INGESTION_RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "partial_failure",
  "failed",
] as const;
export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

/**
 * Map of array-typed taxonomy fields to their allowed value sets.
 *
 * Used by {@link validateTaxonomyArray} / repository create paths to ensure
 * every element of an array column is a member of its canonical vocabulary
 * before it reaches the database (no DB CHECK enforces array elements).
 */
export const ARRAY_TAXONOMY_FIELDS = {
  markets: KNOWLEDGE_MARKETS,
  industries: KNOWLEDGE_INDUSTRIES,
  businessModels: KNOWLEDGE_BUSINESS_MODELS,
  objectives: KNOWLEDGE_OBJECTIVES,
  funnelStages: KNOWLEDGE_FUNNEL_STAGES,
  channels: KNOWLEDGE_CHANNELS,
  seasons: KNOWLEDGE_SEASONS,
  budgetModes: KNOWLEDGE_BUDGET_MODES,
} as const;

export type ArrayTaxonomyFieldName = keyof typeof ARRAY_TAXONOMY_FIELDS;

/**
 * Validate that every element of `values` belongs to the allowed set for the
 * given taxonomy field. Throws on the first invalid element with a message
 * naming the field and the offending value.
 */
export function validateTaxonomyArray(
  field: ArrayTaxonomyFieldName,
  values: readonly string[],
): void {
  const allowed = new Set<string>(ARRAY_TAXONOMY_FIELDS[field]);
  for (const value of values) {
    if (!allowed.has(value)) {
      throw new RangeError(
        `marketing-knowledge taxonomy: "${value}" is not a valid ${field} (allowed: ${[
          ...allowed,
        ].join(", ")})`,
      );
    }
  }
}

/**
 * Validate all array-typed taxonomy fields on a version-create payload at
 * once. Throws a `RangeError` on the first offending element.
 */
export function validateVersionTaxonomyArrays(values: {
  markets?: readonly string[];
  industries?: readonly string[];
  businessModels?: readonly string[];
  objectives?: readonly string[];
  funnelStages?: readonly string[];
  channels?: readonly string[];
  seasons?: readonly string[];
  budgetModes?: readonly string[];
}): void {
  for (const field of Object.keys(ARRAY_TAXONOMY_FIELDS) as ArrayTaxonomyFieldName[]) {
    const list = values[field];
    if (list && list.length > 0) {
      validateTaxonomyArray(field, list);
    }
  }
}

/**
 * Validate a scalar taxonomy value against an allowed set.
 */
export function assertTaxonomyValue<T extends string>(
  allowed: readonly T[],
  value: string,
  field: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new RangeError(
      `marketing-knowledge taxonomy: "${value}" is not a valid ${field} (allowed: ${[
        ...allowed,
      ].join(", ")})`,
    );
  }
}