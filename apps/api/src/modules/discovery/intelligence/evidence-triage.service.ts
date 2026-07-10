import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { AiEvidenceTriageClient } from "../ai-client/ai-evidence-triage.client";
import { ResearchObservationKind } from "../discovery-state";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import {
  EvidenceClassification,
  EvidenceTriageCandidate,
  EvidenceTriageDecision,
} from "./evidence-triage.types";
import {
  IntelligenceObservationCandidate,
  IntelligenceSourceCandidate,
} from "./intelligence.types";
import { SearchQueryIntent, SearchProviderHint } from "./query-plan.types";
import { SearchResultCandidate } from "./search-result.types";

type TriageInput = {
  readonly dto: StartDiscoveryDto;
  readonly intent: SearchQueryIntent;
  readonly results: readonly SearchResultCandidate[];
  readonly sourceStartIndex: number;
};

type CandidateMappingContext = {
  readonly fetchedAt: string;
  readonly sourceIndex: number;
  readonly status: "accepted" | "discarded";
};

export type EvidenceTriageMappingResult = {
  readonly source_refs: readonly IntelligenceSourceCandidate[];
  readonly research_observations: readonly IntelligenceObservationCandidate[];
  readonly accepted_count: number;
  readonly discarded_count: number;
};

@Injectable()
export class EvidenceTriageService {
  constructor(private readonly aiClient: AiEvidenceTriageClient) {}

  async triage(
    input: TriageInput,
    signal?: AbortSignal,
  ): Promise<EvidenceTriageMappingResult> {
    if (input.results.length === 0) {
      return {
        source_refs: [],
        research_observations: [],
        accepted_count: 0,
        discarded_count: 0,
      };
    }

    const candidates = input.results.map((result, index) =>
      triageCandidate(result, input.intent, index),
    );
    const triage = await this.aiClient.triage(
      {
        language_mode: input.dto.language_mode,
        intake: input.dto.intake,
        candidates,
      },
      signal,
    );
    const decisionsByIndex = new Map(
      triage.decisions.map((decision) => [decision.index, decision]),
    );
    const fetchedAt = new Date().toISOString();
    const sourceRefs: IntelligenceSourceCandidate[] = [];
    const observations: IntelligenceObservationCandidate[] = [];

    input.results.forEach((result, index) => {
      const decision = decisionsByIndex.get(index);
      if (!decision) {
        throw new ProviderError(
          "AI_TRIAGE_INVALID_OUTPUT",
          `AI evidence triage missed candidate ${index}.`,
          true,
        );
      }
      const status: CandidateMappingContext["status"] =
        decision.evidence_tier === "discarded" ? "discarded" : "accepted";
      const sourceIndex = input.sourceStartIndex + index;
      const context = { fetchedAt, sourceIndex, status };
      sourceRefs.push(sourceCandidate(result, decision, context));
      observations.push(
        observationCandidate(result, decision, context),
      );
    });

    const acceptedCount = observations.filter(
      (observation) => observation.status !== "discarded",
    ).length;

    return {
      source_refs: sourceRefs,
      research_observations: observations,
      accepted_count: acceptedCount,
      discarded_count: observations.length - acceptedCount,
    };
  }
}

function triageCandidate(
  result: SearchResultCandidate,
  intent: SearchQueryIntent,
  index: number,
): EvidenceTriageCandidate {
  return {
    index,
    intent,
    provider: result.provider,
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    query: result.query,
    rank: result.rank,
    provider_confidence: result.confidence,
    metadata: primitiveMetadata(result.metadata ?? {}),
  };
}

function sourceCandidate(
  result: SearchResultCandidate,
  decision: EvidenceTriageDecision,
  context: CandidateMappingContext,
): IntelligenceSourceCandidate {
  return {
    source_type: "search_result",
    platform: result.provider,
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    fetched_at: context.fetchedAt,
    confidence: decision.confidence,
    status: context.status,
    metadata: {
      ...(result.metadata ?? {}),
      provider: result.provider,
      rank: result.rank,
      query: result.query,
      triage_source: "llm",
      evidence_tier: decision.evidence_tier,
      classification: decision.classification,
      triage_reason: decision.reason,
      suggested_owner_question: decision.suggested_owner_question,
      candidate_facts: decision.candidate_facts,
    },
  };
}

function observationCandidate(
  result: SearchResultCandidate,
  decision: EvidenceTriageDecision,
  context: CandidateMappingContext,
): IntelligenceObservationCandidate {
  return {
    kind: observationKind(decision.classification),
    statement: statementText(result, decision),
    source_index: context.sourceIndex,
    confidence: decision.confidence,
    visibility: decision.classification === "competitor" ? "owner_visible" : "internal",
    status: context.status,
    discard_reason: context.status === "discarded" ? decision.reason : undefined,
    metadata: {
      provider: result.provider,
      rank: result.rank,
      query: result.query,
      triage_source: "llm",
      evidence_tier: decision.evidence_tier,
      classification: decision.classification,
      suggested_owner_question: decision.suggested_owner_question,
      candidate_facts: decision.candidate_facts,
    },
  };
}

function observationKind(
  classification: EvidenceClassification,
): ResearchObservationKind {
  switch (classification) {
    case "own_business":
    case "directory":
      return "digital_presence";
    case "competitor":
      return "competitor";
    case "market_context":
      return "market_context";
    case "social_signal":
      return "social_signal";
    case "irrelevant":
      return "metadata";
    default:
      return assertNever(classification);
  }
}

function statementText(
  result: SearchResultCandidate,
  decision: EvidenceTriageDecision,
): string {
  if (decision.synthesized_observation) {
    return decision.synthesized_observation;
  }

  if (decision.suggested_owner_question) {
    return `${decision.reason} Suggested confirmation: ${decision.suggested_owner_question}`;
  }

  return result.snippet ?? result.title ?? decision.reason;
}

function primitiveMetadata(
  metadata: Record<string, unknown>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled evidence classification: ${value}`);
}
