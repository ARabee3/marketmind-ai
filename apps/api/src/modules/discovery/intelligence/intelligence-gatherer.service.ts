import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { safeError } from "../../../common/errors/safe-error";
import {
  IntelligenceResult,
  ResearchObservationKind,
} from "../discovery-state";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import {
  IntelligenceMappingInput,
  IntelligenceObservationCandidate,
  IntelligenceProgressCallback,
  IntelligenceSourceCandidate,
} from "./intelligence.types";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchQueryIntent } from "./query-plan.types";
import { SearchClientService } from "./search-client.service";
import { SearchResultCandidate } from "./search-result.types";

const MAX_QUERIES_PER_RUN = 4;

@Injectable()
export class IntelligenceGathererService {
  constructor(
    private readonly queryPlanner: QueryPlannerService,
    private readonly searchClient: SearchClientService,
    private readonly metadataExtractor: MetadataExtractorService,
    private readonly mapper: IntelligenceContractMapper,
  ) {}

  async gather(
    dto: StartDiscoveryDto,
    onProgress?: IntelligenceProgressCallback,
  ): Promise<IntelligenceResult> {
    await onProgress?.({
      stage: "query_planning",
      status: "started",
      messageKey: "discovery.query_planning.started",
      messageText: "Planning useful research searches.",
    });
    const plan = await this.queryPlanner.plan(dto);
    await onProgress?.({
      stage: "query_planning",
      status: "completed",
      messageKey: "discovery.query_planning.completed",
      messageText: "Research searches are ready.",
      payload: { query_count: plan.queries.length, source: plan.source },
    });
    await onProgress?.({
      stage: "metadata",
      status: "started",
      messageKey: "discovery.metadata.started",
      messageText: "Checking owner-submitted links.",
    });
    const metadata = await this.metadataExtractor.extract(dto);
    await onProgress?.({
      stage: "metadata",
      status: "completed",
      messageKey: "discovery.metadata.completed",
      messageText: "Owner-submitted links were checked.",
      payload: { source_count: metadata.source_refs.length },
    });
    const sourceCandidates: IntelligenceSourceCandidate[] = [];
    const observationCandidates: IntelligenceObservationCandidate[] = [];

    try {
      sourceCandidates.push(...metadata.source_refs);
      observationCandidates.push(...metadata.research_observations);

      for (const plannedQuery of plan.queries.slice(0, MAX_QUERIES_PER_RUN)) {
        await onProgress?.({
          stage: "search",
          status: "started",
          messageKey: "discovery.search.started",
          messageText: "Searching public sources.",
          payload: {
            intent: plannedQuery.intent,
            query: plannedQuery.query,
          },
        });
        const results = await this.searchClient.search(
          plannedQuery.query,
          plannedQuery.provider_hints,
        );
        await onProgress?.({
          stage: "search",
          status: "completed",
          messageKey: "discovery.search.completed",
          messageText: "Public source search finished.",
          payload: {
            intent: plannedQuery.intent,
            result_count: results.length,
          },
        });
        const sourceStartIndex = sourceCandidates.length;
        sourceCandidates.push(...this.toSources(results));
        observationCandidates.push(
          ...this.toObservations(
            results,
            plannedQuery.intent,
            sourceStartIndex,
          ),
        );
      }

      return this.mapper.toIntelligenceResult({
        status: sourceCandidates.length > 0 ? "complete" : "partial",
        source_refs: sourceCandidates,
        research_observations: observationCandidates,
        knowledge_gaps:
          sourceCandidates.length > 0
            ? []
            : [
                {
                  field_key: "search_sources",
                  question_hint:
                    "I could not find enough public search data. Which links or competitors should I check?",
                  priority: 2,
                },
              ],
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }

      return this.mapper.toIntelligenceResult({
        status: sourceCandidates.length > 0 ? "partial" : "failed",
        source_refs: sourceCandidates,
        research_observations: observationCandidates,
        safe_error: safeError(error.code, error.message, error.retryable),
      });
    }
  }

  private toSources(
    results: readonly SearchResultCandidate[],
  ): readonly IntelligenceSourceCandidate[] {
    const fetchedAt = new Date().toISOString();

    return results.map((result) => ({
      source_type: "search_result",
      platform: result.provider,
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      fetched_at: fetchedAt,
      confidence: result.confidence,
      metadata: {
        ...(result.metadata ?? {}),
        provider: result.provider,
        rank: result.rank,
        query: result.query,
      },
    }));
  }

  private toObservations(
    results: readonly SearchResultCandidate[],
    intent: SearchQueryIntent,
    sourceStartIndex: number,
  ): readonly IntelligenceObservationCandidate[] {
    return results.map((result, index) => ({
      kind: observationKindForIntent(intent),
      statement: result.snippet ?? result.title ?? "Search result found.",
      source_index: sourceStartIndex + index,
      confidence: result.confidence,
      visibility:
        intent === "competitor_discovery" ? "owner_visible" : "internal",
      metadata: {
        provider: result.provider,
        rank: result.rank,
        query: result.query,
      },
    }));
  }
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
