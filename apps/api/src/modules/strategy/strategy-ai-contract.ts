import { StrategyRepository } from "./strategy.repository";

/**
 * Builders that translate API-side rows (StrategyBrief, BusinessProfileVersion,
 * Business, StrategyRetrievalRun) into the exact payload shapes the FastAPI
 * strategy service validates (packages/contracts/python/strategy_contracts.py
 * and services/ai/app/rag/schemas.py). The AI service rejects any deviation
 * with a 422, so these builders are the single source of truth for the wire
 * contract and must stay byte-for-byte aligned with the Python models.
 */

type Brief = NonNullable<
  Awaited<ReturnType<StrategyRepository["readStrategy"]>>
>["brief"];

type ProfileVersion = NonNullable<
  Awaited<ReturnType<StrategyRepository["getProfileVersionById"]>>
>;

type Business = NonNullable<
  Awaited<ReturnType<StrategyRepository["getStrategyByIdAndOwner"]>>
>["business"];

type RetrievalRun = NonNullable<
  Awaited<ReturnType<StrategyRepository["getRetrievalRunById"]>>
>;

/**
 * Objective → funnel stage mapping. The Strategy brief form collects a primary
 * objective but no funnel stage, while the AI retrieval contract requires one.
 * The values mirror the canonical plan/retrieval fixtures
 * (acquisition → awareness_to_purchase, conversion → conversion).
 */
export const OBJECTIVE_FUNNEL_STAGES: Record<string, string> = {
  awareness: "awareness",
  acquisition: "awareness_to_purchase",
  conversion: "conversion",
  retention: "retention",
  launch: "launch",
};

export function buildRetrievalQueryContext(
  brief: Brief,
  profileVersion: ProfileVersion,
  business: Business,
) {
  const profile = toPayload(profileVersion.profile);
  const confirmedFacts = toPayload(profile.confirmed_facts);
  const currentMarketing = toPayload(confirmedFacts.current_marketing);

  return {
    business_type: businessTypeOf(profile, business),
    market: "egypt",
    locale: brief?.planLanguage ?? business.primaryLocale ?? "ar-EG",
    objective: brief?.primaryObjective ?? "conversion",
    funnel_stage:
      OBJECTIVE_FUNNEL_STAGES[brief?.primaryObjective ?? ""] ?? "awareness",
    active_channels: toStringArray(currentMarketing.active_channels),
    asset_capability: toStringArray(currentMarketing.available_assets),
    team_capacity: brief?.teamCapacity ?? "",
    budget_mode: brief?.externalBudgetMode ?? "organic_only",
    industry: businessTypeOf(profile, business),
    free_text_notes: brief?.constraints ?? null,
    paid_media_allowed: brief?.paidMediaAllowed ?? true,
  };
}

export function buildBusinessProfilePayload(profileVersion: ProfileVersion) {
  return {
    id: profileVersion.id,
    business_id: profileVersion.businessId,
    draft_id: profileVersion.draftId ?? undefined,
    version: profileVersion.version,
    profile: profileVersion.profile,
    confirmed_by_user_id: profileVersion.confirmedByUserId,
    confirmed_at: profileVersion.confirmedAt.toISOString(),
    created_at: profileVersion.createdAt.toISOString(),
  };
}

function toChannelChoices(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object",
    )
    .map((entry) => {
      const choice: Record<string, unknown> = {
        channel: stringField(entry.channel),
        role: stringField(entry.role),
        setup_state: stringField(entry.setup_state),
      };
      if (typeof entry.public_url === "string" && entry.public_url.trim()) {
        choice.public_url = entry.public_url;
      }
      if (typeof entry.publishing_target_id === "string") {
        choice.publishing_target_id = entry.publishing_target_id;
      }
      if (typeof entry.note === "string" && entry.note.trim()) {
        choice.note = entry.note;
      }
      return choice;
    })
    .filter(
      (choice) => choice.channel && choice.role && choice.setup_state,
    );
}

/**
 * Builds the contract brief for the AI payload. strategy-v2 briefs replace the
 * free-text `team_capacity` with the plain-language `weekly_capacity` preset
 * and carry the owner-selected `channel_choices`; v1 briefs are unchanged.
 */
export function buildContractBrief(
  brief: Brief,
  profileVersion: ProfileVersion,
  contractVersion: string,
) {
  if (!brief) {
    throw new Error("Strategy brief missing when building contract payload");
  }
  const base = {
    id: brief.id,
    strategy_id: brief.strategyId,
    business_profile_version: {
      business_profile_version_id: profileVersion.id,
      confirmed_at: profileVersion.confirmedAt.toISOString(),
      version: profileVersion.version,
    },
    primary_objective: brief.primaryObjective,
    start_date: brief.startDate.toISOString(),
    plan_language: brief.planLanguage,
    paid_media_allowed: brief.paidMediaAllowed,
    external_budget_mode: brief.externalBudgetMode,
    external_budget_egp: brief.externalBudgetEgp ?? null,
    constraints: splitConstraints(brief.constraints),
    clarification_answers: toClarificationAnswers(brief.clarificationAnswers),
    created_at: brief.createdAt.toISOString(),
    updated_at: brief.updatedAt.toISOString(),
  };
  if (contractVersion !== "strategy-v2") {
    return {
      ...base,
      team_capacity: brief.teamCapacity,
    };
  }
  return {
    ...base,
    weekly_capacity: brief.weeklyCapacity ?? "one_to_two_hours",
    weekly_capacity_note: brief.weeklyCapacityNote ?? null,
    channel_choices: toChannelChoices(brief.channelChoices),
  };
}

/**
 * Contract knowledge pack shape sent to POST /generate and /revise. Matches
 * strategy_contracts.RetrievedKnowledgePack (nested source_quality items).
 */
export function toContractRetrievalPack(run: RetrievalRun) {
  return {
    retrieval_run_id: run.id,
    strategy_id: run.strategyId,
    brief_id: run.briefId,
    profile_version_id: run.profileVersionId,
    query_summary: run.querySummary,
    query_context: toPayload(run.queryContext),
    items: run.items.map((item) => ({
      chunk_id: item.chunkId,
      entry_id: item.entryId,
      entry_version: item.entryVersion,
      title: item.title,
      excerpt: item.excerpt,
      kind: item.kind,
      tags: toStringArrayRecord(item.tags),
      relevance_score: item.relevanceScore,
      source_quality: {
        evidence_tier: item.evidenceTier,
        source_references: item.sourceReferences,
        effective_at: item.effectiveAt.toISOString(),
        expires_at: item.expiresAt?.toISOString() ?? null,
        review_status: item.reviewStatus,
      },
      market_tier: item.marketTier,
      is_fallback: item.isFallback,
      fallback_label: item.fallbackLabel,
    })),
    knowledge_gaps: run.gaps.map((gap) => ({
      category: gap.category,
      description: gap.description,
      severity: gap.severity,
    })),
    retrieval_metadata: toContractRetrievalMetadata(run),
    retrieved_at: (run.finishedAt ?? run.createdAt).toISOString(),
  };
}

/**
 * RAG-shaped pack sent to POST /score (ScoreStrategyRequest expects
 * app.rag.schemas.RetrievedKnowledgePack with flat HydratedItem items).
 */
export function toRagRetrievalPack(run: RetrievalRun) {
  return {
    retrieval_run_id: run.id,
    query_summary: run.querySummary,
    query_context: toPayload(run.queryContext),
    profile_version_id: run.profileVersionId,
    brief_id: run.briefId,
    items: run.items.map((item) => ({
      chunk_id: item.chunkId,
      entry_id: item.entryId,
      entry_version: item.entryVersion,
      title: item.title,
      excerpt: item.excerpt,
      kind: item.kind,
      tags: toStringArrayRecord(item.tags),
      relevance_score: item.relevanceScore,
      evidence_tier: item.evidenceTier,
      source_references: item.sourceReferences,
      effective_at: item.effectiveAt.toISOString(),
      expires_at: item.expiresAt?.toISOString() ?? null,
      review_status: item.reviewStatus,
      market_tier: item.marketTier,
      is_fallback: item.isFallback,
      fallback_label: item.fallbackLabel,
      category: item.kind,
    })),
    knowledge_gaps: run.gaps.map((gap) => ({
      category: gap.category,
      description: gap.description,
      severity: gap.severity,
    })),
    retrieval_metadata: toPayload(run.configuration),
    retrieved_at: (run.finishedAt ?? run.createdAt).toISOString(),
  };
}

function toContractRetrievalMetadata(run: RetrievalRun) {
  const configuration = toPayload(run.configuration);
  return {
    embedding_provider:
      configuration.embedding_provider ?? configuration.embeddingProvider ?? "fake",
    embedding_model:
      configuration.embedding_model ?? configuration.embeddingModel ?? "text-embedding-3-small",
    embedding_dimensions:
      configuration.embedding_dimensions
      ?? configuration.embeddingDimensions
      ?? 1536,
    collection_name:
      configuration.collection_name
      ?? configuration.collectionName
      ?? configuration.qdrant_collection
      ?? "marketing_knowledge_v1",
    retrieval_latency_ms: run.latencyMs,
  };
}

function businessTypeOf(profile: Record<string, unknown>, business: Business) {
  const profileType = profile.business_type;
  if (typeof profileType === "string" && profileType.trim()) {
    return profileType.trim();
  }
  return business.businessType ?? "retail";
}

/**
 * The Strategy brief form collects `constraints` as a single free-text string
 * (the DTO/DB column), while the contract StrategyBrief expects an array of
 * constraints. Splitting on newlines preserves each owner-written line as one
 * constraint without inventing structure.
 */
function splitConstraints(value: string | null | undefined): string[] {
  if (!value || !value.trim()) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toClarificationAnswers(value: unknown) {
  const parsed = toPayload(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object",
    )
    .map((entry) => ({
      question_id: stringField(entry.question_id),
      question_text: stringField(entry.question_text),
      answer_text: stringField(entry.answer_text),
      answered_at: stringField(entry.answered_at),
    }))
    .filter(
      (answer) => answer.question_id && answer.question_text && answer.answer_text,
    );
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function toStringArrayRecord(value: unknown): Record<string, string[]> {
  const input = toPayload(value);
  const result: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(input)) {
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      result[key] = item;
    }
  }
  return result;
}

function toPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    payload[key] = item;
  }
  return payload;
}
