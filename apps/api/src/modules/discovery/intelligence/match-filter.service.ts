import { Injectable } from "@nestjs/common";
import { ResearchObservationKind } from "../discovery-state";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import {
  IntelligenceObservationCandidate,
  IntelligenceSourceCandidate,
} from "./intelligence.types";
import { SearchQueryIntent } from "./query-plan.types";
import { SearchResultCandidate } from "./search-result.types";
import { ConfidenceService } from "./confidence.service";

export type MatchFilterInput = {
  readonly dto: StartDiscoveryDto;
  readonly intent: SearchQueryIntent;
  readonly results: readonly SearchResultCandidate[];
  readonly sourceStartIndex: number;
};

export type MatchFilterResult = {
  readonly source_refs: readonly IntelligenceSourceCandidate[];
  readonly research_observations: readonly IntelligenceObservationCandidate[];
  readonly accepted_count: number;
  readonly discarded_count: number;
};

@Injectable()
export class MatchFilterService {
  constructor(private readonly confidence: ConfidenceService) {}

  filter(input: MatchFilterInput): MatchFilterResult {
    const fetchedAt = new Date().toISOString();
    const sourceRefs: IntelligenceSourceCandidate[] = [];
    const observations: IntelligenceObservationCandidate[] = [];
    let acceptedCount = 0;
    let discardedCount = 0;

    input.results.forEach((result, index) => {
      const confidence = this.confidence.score(input.dto, result);
      const discardReason = this.confidence.discardReason(confidence);
      const status = discardReason ? "discarded" : "accepted";
      if (status === "accepted") {
        acceptedCount += 1;
      } else {
        discardedCount += 1;
      }

      sourceRefs.push(sourceCandidate(result, fetchedAt, confidence, status));
      observations.push(
        observationCandidate(
          result,
          input.intent,
          input.sourceStartIndex + index,
          confidence,
          status,
          discardReason,
        ),
      );
    });

    return {
      source_refs: sourceRefs,
      research_observations: observations,
      accepted_count: acceptedCount,
      discarded_count: discardedCount,
    };
  }
}

function sourceCandidate(
  result: SearchResultCandidate,
  fetchedAt: string,
  confidence: number,
  status: "accepted" | "discarded",
): IntelligenceSourceCandidate {
  return {
    source_type: "search_result",
    platform: result.provider,
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    fetched_at: fetchedAt,
    confidence,
    status,
    metadata: {
      ...(result.metadata ?? {}),
      provider: result.provider,
      rank: result.rank,
      query: result.query,
    },
  };
}

function observationCandidate(
  result: SearchResultCandidate,
  intent: SearchQueryIntent,
  sourceIndex: number,
  confidence: number,
  status: "accepted" | "discarded",
  discardReason: string | undefined,
): IntelligenceObservationCandidate {
  return {
    kind: observationKindForIntent(intent),
    statement:
      status === "discarded"
        ? `Discarded search result: ${discardReason ?? "low confidence match"}`
        : result.snippet ?? result.title ?? "Search result found.",
    source_index: sourceIndex,
    confidence,
    visibility:
      intent === "competitor_discovery" && status === "accepted"
        ? "owner_visible"
        : "internal",
    status,
    discard_reason: discardReason,
    metadata: {
      provider: result.provider,
      rank: result.rank,
      query: result.query,
    },
  };
}

function observationKindForIntent(
  intent: SearchQueryIntent,
): ResearchObservationKind {
  switch (intent) {
    case "business_match":
    case "review_presence":
      return "digital_presence";
    case "competitor_discovery":
      return "competitor";
    case "market_context":
      return "market_context";
    case "social_profile":
      return "social_signal";
    default:
      return assertNever(intent);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled search query intent: ${value}`);
}
