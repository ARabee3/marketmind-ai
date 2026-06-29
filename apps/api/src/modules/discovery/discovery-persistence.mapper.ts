import { Prisma } from "@prisma/client";
import {
  ConversationHook,
  DiscoverySessionStatus,
  IntelligenceResult,
  KnowledgeGap,
  ResearchObservation,
  SourceRef,
  SourceType,
  emptyRunningIntelligence,
} from "./discovery-state";
import { LanguageModeDto } from "./dto/start-discovery.dto";

export type PersistedDiscoveryIntelligence = {
  readonly intelligenceRuns: readonly PersistedIntelligenceRun[];
  readonly sourceRefs: readonly PersistedSourceRef[];
  readonly researchObservations: readonly PersistedResearchObservation[];
  readonly conversationHooks: readonly PersistedConversationHook[];
  readonly knowledgeGaps: readonly PersistedKnowledgeGap[];
};

export type PersistedIntelligenceRun = {
  readonly status: string;
  readonly searchMode: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
};

export type PersistedSourceRef = {
  readonly id: string;
  readonly sourceType: string;
  readonly platform: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly snippet: string | null;
  readonly fetchedAt: Date | null;
  readonly confidence: Prisma.Decimal;
  readonly metadata: Prisma.JsonValue;
};

export type PersistedResearchObservation = {
  readonly id: string;
  readonly sourceRefId: string | null;
  readonly kind: string;
  readonly statement: string;
  readonly confidence: Prisma.Decimal;
  readonly visibility: string;
  readonly status: string;
  readonly discardReason: string | null;
  readonly metadata: Prisma.JsonValue;
};

export type PersistedConversationHook = {
  readonly id: string;
  readonly sourceObservationId: string | null;
  readonly hookText: string;
  readonly language: string;
  readonly status: string;
};

export type PersistedKnowledgeGap = {
  readonly id: string;
  readonly fieldKey: string;
  readonly questionHint: string;
  readonly priority: number;
  readonly status: string;
};

export function intelligenceFromPersistence(
  persisted: PersistedDiscoveryIntelligence,
): IntelligenceResult {
  const latestRun = persisted.intelligenceRuns[0];

  if (
    !latestRun &&
    persisted.sourceRefs.length === 0 &&
    persisted.researchObservations.length === 0 &&
    persisted.conversationHooks.length === 0 &&
    persisted.knowledgeGaps.length === 0
  ) {
    return emptyRunningIntelligence();
  }

  return {
    status: intelligenceStatus(latestRun?.status),
    search_mode: searchMode(latestRun?.searchMode),
    source_refs: persisted.sourceRefs.map(toSourceRef),
    research_observations: persisted.researchObservations.map(toObservation),
    conversation_hooks: persisted.conversationHooks.map(toHook),
    knowledge_gaps: persisted.knowledgeGaps.map(toKnowledgeGap),
    safe_error:
      latestRun?.errorCode && latestRun.errorMessage
        ? {
            code: latestRun.errorCode,
            message: latestRun.errorMessage,
            retryable: true,
          }
        : undefined,
  };
}

export function sessionStatusForIntelligence(
  intelligence: IntelligenceResult,
): DiscoverySessionStatus {
  switch (intelligence.status) {
    case "running":
      return "researching";
    case "partial":
      return "partial_ready";
    case "complete":
      return "ready_for_chat";
    case "failed":
      return "research_failed";
    default:
      return assertNever(intelligence.status);
  }
}

export function metadataForPrisma(
  metadata: Record<string, unknown>,
): Prisma.InputJsonObject {
  return metadata as Prisma.InputJsonObject;
}

function toSourceRef(row: PersistedSourceRef): SourceRef {
  return {
    id: row.id,
    source_type: sourceType(row.sourceType),
    platform: row.platform ?? undefined,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    snippet: row.snippet ?? undefined,
    fetched_at: row.fetchedAt?.toISOString(),
    confidence: Number(row.confidence),
    metadata: metadataFromJson(row.metadata),
  };
}

function toObservation(row: PersistedResearchObservation): ResearchObservation {
  return {
    id: row.id,
    source_ref_id: row.sourceRefId ?? undefined,
    kind: observationKind(row.kind),
    statement: row.statement,
    confidence: Number(row.confidence),
    visibility:
      row.visibility === "owner_visible" ? "owner_visible" : "internal",
    status: row.status === "discarded" ? "discarded" : "accepted",
    discard_reason: row.discardReason ?? undefined,
    metadata: metadataFromJson(row.metadata),
  };
}

function toHook(row: PersistedConversationHook): ConversationHook {
  return {
    id: row.id,
    source_observation_id: row.sourceObservationId ?? undefined,
    hook_text: row.hookText,
    language: languageMode(row.language),
    status: hookStatus(row.status),
  };
}

function toKnowledgeGap(row: PersistedKnowledgeGap): KnowledgeGap {
  return {
    id: row.id,
    field_key: row.fieldKey,
    question_hint: row.questionHint,
    priority: row.priority,
    status: gapStatus(row.status),
  };
}

function metadataFromJson(value: Prisma.JsonValue): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function intelligenceStatus(
  status: string | undefined,
): IntelligenceResult["status"] {
  switch (status) {
    case "partial":
    case "complete":
    case "failed":
    case "running":
      return status;
    default:
      return "running";
  }
}

function searchMode(
  value: string | undefined,
): IntelligenceResult["search_mode"] {
  switch (value) {
    case "free_search":
    case "provider_later":
    case "metadata_only":
      return value;
    default:
      return "metadata_only";
  }
}

function sourceType(value: string): SourceType {
  switch (value) {
    case "owner_link":
    case "metadata":
    case "search_result":
    case "manual_owner_answer":
      return value;
    default:
      return "metadata";
  }
}

function observationKind(value: string): ResearchObservation["kind"] {
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

function hookStatus(value: string): ConversationHook["status"] {
  switch (value) {
    case "used":
    case "discarded":
    case "active":
      return value;
    default:
      return "active";
  }
}

function gapStatus(value: string): KnowledgeGap["status"] {
  switch (value) {
    case "answered":
    case "skipped":
    case "open":
      return value;
    default:
      return "open";
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled intelligence status: ${value}`);
}
