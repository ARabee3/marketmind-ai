import { Prisma } from "@prisma/client";
import {
  BusinessProfileDraft,
  DiscoveryMessage,
  ProfileUncertainty,
  ResearchObservation,
} from "./discovery-state";
import { LanguageModeDto } from "./dto/start-discovery.dto";

export type PersistedDiscoveryMessage = {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly language: string;
  readonly source: string;
  readonly createdAt: Date;
};

export type PersistedBusinessProfileDraft = {
  readonly id: string;
  readonly sessionId: string;
  readonly version: number;
  readonly status: string;
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
  return {
    id: message.id,
    role: messageRole(message.role),
    content: message.content,
    language: languageMode(message.language),
    source: messageSource(message.source),
    created_at: message.createdAt.toISOString(),
  };
}

export function profileDraftFromPersistence(
  draft: PersistedBusinessProfileDraft,
): BusinessProfileDraft {
  return {
    id: draft.id,
    session_id: draft.sessionId,
    version: draft.version,
    status: draftStatus(draft.status),
    confirmed_facts: jsonObject(draft.confirmedFacts),
    research_observations: researchObservations(draft.researchObservations),
    uncertainties: uncertainties(draft.uncertainties),
    owner_goals: stringArray(draft.ownerGoals),
    strategy_relevant_notes: stringArray(draft.strategyRelevantNotes),
    raw_ai_output: jsonObject(draft.rawAiOutput),
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

function stringArray(value: Prisma.JsonValue): string[] {
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
  if (
    typeof record["field_key"] !== "string" ||
    typeof record["description"] !== "string" ||
    typeof record["resolved"] !== "boolean" ||
    !isUncertaintySeverity(record["severity"]) ||
    !isUncertaintyCategory(record["category"]) ||
    !isUncertaintySource(record["source"])
  ) {
    return undefined;
  }

  return {
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
    resolved: record["resolved"],
    resolved_at: optionalString(record["resolved_at"]),
    resolved_by_action: resolutionAction(record["resolved_by_action"]),
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
