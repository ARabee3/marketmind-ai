import { Prisma } from "@prisma/client";
import {
  BusinessProfileDraft,
  DiscoveryCompletionReason,
  DiscoveryDomainScores,
  DiscoveryProfileState,
  DiscoveryReadiness,
  DiscoveryMessage,
  MarketAwareBusinessFacts,
  ProfileUncertainty,
  ResearchObservation,
} from "./discovery-state";
import { LanguageModeDto } from "./dto/start-discovery.dto";
import {
  emptyDiscoveryDomainScores,
  emptyDiscoveryProfileState,
  marketContextFromObservations,
  MAX_DISCOVERY_OWNER_TURNS,
} from "./market-profile";
import { suggestedAnswersFromMetadata } from "./discovery-suggested-answers";

export type PersistedDiscoveryMessage = {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly language: string;
  readonly source: string;
  readonly metadata: Prisma.JsonValue;
  readonly createdAt: Date;
};

export type PersistedBusinessProfileDraft = {
  readonly id: string;
  readonly sessionId: string;
  readonly version: number;
  readonly status: string;
  readonly completeness: string;
  readonly completionReason: string;
  readonly readiness: Prisma.JsonValue;
  readonly confirmedFacts: Prisma.JsonValue;
  readonly researchObservations: Prisma.JsonValue;
  readonly uncertainties: Prisma.JsonValue;
  readonly ownerGoals: Prisma.JsonValue;
  readonly strategyRelevantNotes: Prisma.JsonValue;
  readonly rawAiOutput: Prisma.JsonValue;
};

export function messageFromPersistence(
  message: PersistedDiscoveryMessage,
): DiscoveryMessage {
  const suggestedAnswers = suggestedAnswersFromMetadata(message.metadata);
  return {
    id: message.id,
    role: messageRole(message.role),
    content: message.content,
    language: languageMode(message.language),
    source: messageSource(message.source),
    ...(suggestedAnswers ? { suggested_answers: suggestedAnswers } : {}),
    created_at: message.createdAt.toISOString(),
  };
}

export function profileDraftFromPersistence(
  draft: PersistedBusinessProfileDraft,
): BusinessProfileDraft {
  const observations = researchObservations(draft.researchObservations);

  return {
    id: draft.id,
    session_id: draft.sessionId,
    version: draft.version,
    status: draftStatus(draft.status),
    completeness: draft.completeness === "complete" ? "complete" : "incomplete",
    completion_reason: completionReason(draft.completionReason),
    readiness: readinessFromJson(draft.readiness),
    confirmed_facts: marketAwareFacts(draft.confirmedFacts),
    market_context: marketContextFromObservations(observations),
    research_observations: observations,
    uncertainties: uncertainties(draft.uncertainties),
    owner_goals: stringArray(draft.ownerGoals),
    strategy_relevant_notes: stringArray(draft.strategyRelevantNotes),
    raw_ai_output: jsonObject(draft.rawAiOutput),
  };
}

export function profileStateFromPersistence(
  value: Prisma.JsonValue,
  ownerTurnCount: number,
  persistedCompletionReason: string | null,
): DiscoveryProfileState {
  const record = jsonObject(value);
  if (Object.keys(record).length === 0) {
    const empty = emptyDiscoveryProfileState();
    return {
      ...empty,
      readiness: {
        ...empty.readiness,
        owner_turn_count: ownerTurnCount,
        completion_reason: persistedCompletionReason
          ? completionReason(persistedCompletionReason)
          : undefined,
      },
    };
  }

  const readiness = readinessFromJson(record["readiness"] as Prisma.JsonValue);
  return {
    known_facts: marketAwareFacts(record["known_facts"] as Prisma.JsonValue),
    uncertainties: uncertaintyInputs(
      record["uncertainties"] as Prisma.JsonValue,
    ),
    readiness: {
      ...readiness,
      owner_turn_count: ownerTurnCount,
      completion_reason: persistedCompletionReason
        ? completionReason(persistedCompletionReason)
        : readiness.completion_reason,
    },
  };
}

function marketAwareFacts(value: Prisma.JsonValue): MarketAwareBusinessFacts {
  const record = jsonObject(value);
  const identity = jsonObject(record["identity"] as Prisma.JsonValue);
  const offer = jsonObject(record["offer"] as Prisma.JsonValue);
  const customers = jsonObject(record["customers"] as Prisma.JsonValue);
  const differentiation = jsonObject(
    record["differentiation"] as Prisma.JsonValue,
  );
  const currentMarketing = jsonObject(
    record["current_marketing"] as Prisma.JsonValue,
  );
  const goalsAndConstraints = jsonObject(
    record["goals_and_constraints"] as Prisma.JsonValue,
  );

  return {
    identity: {
      business_name: optionalString(
        identity["business_name"] ?? record["business_name"],
      ),
      business_type: optionalString(
        identity["business_type"] ?? record["business_type"],
      ),
      city: optionalString(identity["city"] ?? record["city"]),
      area: optionalString(identity["area"] ?? record["area"]),
    },
    offer: {
      core_offerings: stringArray(offer["core_offerings"]),
      best_sellers: stringArray(offer["best_sellers"]),
      price_range: optionalString(offer["price_range"]),
      purchase_occasions: stringArray(offer["purchase_occasions"]),
    },
    customers: {
      primary_segments: stringArray(customers["primary_segments"]),
      visit_or_order_occasions: stringArray(
        customers["visit_or_order_occasions"],
      ),
      peak_periods: stringArray(customers["peak_periods"]),
      customer_needs: stringArray(customers["customer_needs"]),
    },
    differentiation: {
      owner_claimed_strengths: stringArray(
        differentiation["owner_claimed_strengths"],
      ),
      customer_choice_reasons: stringArray(
        differentiation["customer_choice_reasons"],
      ),
      proof_points: stringArray(differentiation["proof_points"]),
    },
    current_marketing: {
      active_channels: stringArray(currentMarketing["active_channels"]),
      current_activities: stringArray(currentMarketing["current_activities"]),
      delivery_platforms: stringArray(currentMarketing["delivery_platforms"]),
      available_assets: stringArray(currentMarketing["available_assets"]),
    },
    goals_and_constraints: {
      growth_goals: stringArray(goalsAndConstraints["growth_goals"]),
      timeframe: optionalString(goalsAndConstraints["timeframe"]),
      marketing_budget_range: optionalString(
        goalsAndConstraints["marketing_budget_range"],
      ),
      team_capacity: optionalString(goalsAndConstraints["team_capacity"]),
      operational_constraints: stringArray(
        goalsAndConstraints["operational_constraints"],
      ),
    },
  };
}

function messageRole(value: string): DiscoveryMessage["role"] {
  switch (value) {
    case "assistant":
    case "system":
    case "owner":
      return value;
    default:
      return "system";
  }
}

function messageSource(value: string): DiscoveryMessage["source"] {
  switch (value) {
    case "research_hook":
    case "summary":
    case "chat":
      return value;
    default:
      return "chat";
  }
}

function languageMode(value: string): LanguageModeDto {
  switch (value) {
    case LanguageModeDto.ArabicEgypt:
    case LanguageModeDto.English:
    case LanguageModeDto.Mixed:
      return value;
    default:
      return LanguageModeDto.Mixed;
  }
}

function draftStatus(value: string): BusinessProfileDraft["status"] {
  switch (value) {
    case "ready_for_confirmation":
    case "confirmed":
    case "superseded":
    case "draft":
      return value;
    default:
      return "draft";
  }
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function researchObservations(value: Prisma.JsonValue): ResearchObservation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const observation = researchObservation(item);
    return observation ? [observation] : [];
  });
}

function uncertainties(
  value: Prisma.JsonValue,
): BusinessProfileDraft["uncertainties"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const uncertainty = profileUncertainty(item);
    return uncertainty ? [uncertainty] : [];
  });
}

function uncertaintyInputs(
  value: Prisma.JsonValue,
): DiscoveryProfileState["uncertainties"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const uncertainty = profileUncertaintyInput(item);
    return uncertainty ? [uncertainty] : [];
  });
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function researchObservation(
  value: Prisma.JsonValue,
): ResearchObservation | undefined {
  const record = jsonObject(value);
  if (
    typeof record["id"] !== "string" ||
    typeof record["statement"] !== "string"
  ) {
    return undefined;
  }

  return {
    id: record["id"],
    source_ref_id:
      typeof record["source_ref_id"] === "string"
        ? record["source_ref_id"]
        : undefined,
    kind: observationKind(record["kind"]),
    statement: record["statement"],
    confidence:
      typeof record["confidence"] === "number" ? record["confidence"] : 0.5,
    visibility:
      record["visibility"] === "owner_visible" ? "owner_visible" : "internal",
    status: record["status"] === "discarded" ? "discarded" : "accepted",
    discard_reason:
      typeof record["discard_reason"] === "string"
        ? record["discard_reason"]
        : undefined,
    metadata: jsonObject(record["metadata"] as Prisma.JsonValue),
  };
}

function profileUncertainty(
  value: Prisma.JsonValue,
): BusinessProfileDraft["uncertainties"][number] | undefined {
  const record = jsonObject(value);
  const input = profileUncertaintyInput(record);
  if (!input || typeof record["resolved"] !== "boolean") {
    return undefined;
  }

  return {
    ...input,
    resolved: record["resolved"],
    resolved_at: optionalString(record["resolved_at"]),
    resolved_by_action: resolutionAction(record["resolved_by_action"]),
  };
}

function profileUncertaintyInput(
  value: Prisma.JsonValue | Record<string, unknown>,
): DiscoveryProfileState["uncertainties"][number] | undefined {
  const record = isJsonRecord(value) ? value : jsonObject(value);
  if (
    !isProfileDomain(record["domain"]) ||
    typeof record["field_key"] !== "string" ||
    typeof record["description"] !== "string" ||
    !isUncertaintySeverity(record["severity"]) ||
    !isUncertaintyCategory(record["category"]) ||
    !isUncertaintySource(record["source"])
  ) {
    return undefined;
  }

  return {
    domain: record["domain"],
    field_key: record["field_key"],
    description: record["description"],
    severity: record["severity"],
    category: record["category"],
    source: record["source"],
    source_ref_id: optionalString(record["source_ref_id"]),
    owner_stated_value: optionalString(record["owner_stated_value"]),
    research_suggested_value: optionalString(
      record["research_suggested_value"],
    ),
    contradiction_detail: optionalString(record["contradiction_detail"]),
  };
}

function observationKind(value: unknown): ResearchObservation["kind"] {
  switch (value) {
    case "digital_presence":
    case "competitor":
    case "market_context":
    case "social_signal":
    case "metadata":
      return value;
    default:
      return "metadata";
  }
}

function isUncertaintySeverity(
  value: unknown,
): value is ProfileUncertainty["severity"] {
  return value === "low" || value === "medium" || value === "high";
}

function isUncertaintyCategory(
  value: unknown,
): value is ProfileUncertainty["category"] {
  return (
    value === "contradiction" ||
    value === "low_confidence" ||
    value === "owner_unknown" ||
    value === "research_gap" ||
    value === "ambiguous_answer" ||
    value === "missing_information"
  );
}

function isUncertaintySource(
  value: unknown,
): value is ProfileUncertainty["source"] {
  return (
    value === "owner_answer" ||
    value === "owner_unknown" ||
    value === "research_observation" ||
    value === "metadata_extraction" ||
    value === "search_result" ||
    value === "intake_form" ||
    value === "ai_inference"
  );
}

function resolutionAction(
  value: unknown,
): BusinessProfileDraft["uncertainties"][number]["resolved_by_action"] {
  switch (value) {
    case "owner_clarified":
    case "research_confirmed":
    case "discarded":
    case "skipped":
      return value;
    default:
      return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readinessFromJson(value: Prisma.JsonValue): DiscoveryReadiness {
  const record = jsonObject(value);
  const scores = domainScoresFromJson(
    record["domain_scores"] as Prisma.JsonValue,
  );

  return {
    ready: record["ready"] === true,
    llm_recommended: record["llm_recommended"] === true,
    profile_readiness:
      typeof record["profile_readiness"] === "number"
        ? record["profile_readiness"]
        : scores.profile_readiness,
    domain_scores: scores,
    blocking_domains: Array.isArray(record["blocking_domains"])
      ? record["blocking_domains"].filter(isProfileDomain)
      : [],
    owner_turn_count:
      typeof record["owner_turn_count"] === "number"
        ? record["owner_turn_count"]
        : 0,
    max_owner_turns:
      typeof record["max_owner_turns"] === "number"
        ? record["max_owner_turns"]
        : MAX_DISCOVERY_OWNER_TURNS,
    completion_reason:
      typeof record["completion_reason"] === "string"
        ? completionReason(record["completion_reason"])
        : undefined,
  };
}

function domainScoresFromJson(value: Prisma.JsonValue): DiscoveryDomainScores {
  const record = jsonObject(value);
  const empty = emptyDiscoveryDomainScores();

  return {
    identity: confidenceOr(record["identity"], empty.identity),
    offer: confidenceOr(record["offer"], empty.offer),
    customers: confidenceOr(record["customers"], empty.customers),
    differentiation: confidenceOr(
      record["differentiation"],
      empty.differentiation,
    ),
    current_marketing: confidenceOr(
      record["current_marketing"],
      empty.current_marketing,
    ),
    goals_and_constraints: confidenceOr(
      record["goals_and_constraints"],
      empty.goals_and_constraints,
    ),
    market_context: confidenceOr(
      record["market_context"],
      empty.market_context,
    ),
    research_confidence: confidenceOr(
      record["research_confidence"],
      empty.research_confidence,
    ),
    profile_readiness: confidenceOr(
      record["profile_readiness"],
      empty.profile_readiness,
    ),
  };
}

function confidenceOr(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 0 && value <= 1
    ? value
    : fallback;
}

function completionReason(value: string): DiscoveryCompletionReason {
  switch (value) {
    case "sufficient":
    case "owner_finished_early":
    case "turn_limit":
      return value;
    default:
      return "owner_finished_early";
  }
}

function isProfileDomain(
  value: unknown,
): value is DiscoveryReadiness["blocking_domains"][number] {
  return (
    value === "identity" ||
    value === "offer" ||
    value === "customers" ||
    value === "differentiation" ||
    value === "current_marketing" ||
    value === "goals_and_constraints" ||
    value === "market_context"
  );
}

function isJsonRecord(
  value: Prisma.JsonValue | Record<string, unknown>,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
