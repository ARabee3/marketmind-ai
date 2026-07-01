import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { safeError } from "../../../common/errors/safe-error";
import { IntelligenceResult } from "../discovery-state";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import {
  IntelligenceObservationCandidate,
  IntelligenceProgressCallback,
  IntelligenceSourceCandidate,
} from "./intelligence.types";
import { MatchFilterService } from "./match-filter.service";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchClientService } from "./search-client.service";
import { SearchProviderWarning } from "./search-result.types";

const MAX_QUERIES_PER_RUN = 4;

@Injectable()
export class IntelligenceGathererService {
  constructor(
    private readonly queryPlanner: QueryPlannerService,
    private readonly searchClient: SearchClientService,
    private readonly metadataExtractor: MetadataExtractorService,
    private readonly matchFilter: MatchFilterService,
    private readonly mapper: IntelligenceContractMapper,
  ) {}

  async gather(
    dto: StartDiscoveryDto,
    onProgress?: IntelligenceProgressCallback,
    signal?: AbortSignal,
  ): Promise<IntelligenceResult> {
    signal?.throwIfAborted();
    await onProgress?.({
      stage: "query_planning",
      status: "started",
      messageKey: "discovery.query_planning.started",
      messageText: "Planning useful research searches.",
    });
    const plan = await this.queryPlanner.plan(dto, signal);
    signal?.throwIfAborted();
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
    const metadata = await this.metadataExtractor.extract(dto, signal);
    signal?.throwIfAborted();
    await onProgress?.({
      stage: "metadata",
      status: "completed",
      messageKey: "discovery.metadata.completed",
      messageText: "Owner-submitted links were checked.",
      payload: { source_count: metadata.source_refs.length },
    });
    const sourceCandidates: IntelligenceSourceCandidate[] = [];
    const observationCandidates: IntelligenceObservationCandidate[] = [];
    const providerWarnings: SearchProviderWarning[] = [];

    try {
      sourceCandidates.push(...metadata.source_refs);
      observationCandidates.push(...metadata.research_observations);

      const prioritizedQueries = [...plan.queries]
        .sort((left, right) => right.priority - left.priority)
        .slice(0, MAX_QUERIES_PER_RUN);
      for (const plannedQuery of prioritizedQueries) {
        signal?.throwIfAborted();
        const searchStage =
          plannedQuery.intent === "competitor_discovery"
            ? "competitor_searching"
            : "search";
        await onProgress?.({
          stage: searchStage,
          status: "started",
          messageKey: `discovery.${searchStage}.started`,
          messageText: "Searching public sources.",
          payload: {
            intent: plannedQuery.intent,
            query: plannedQuery.query,
          },
        });
        const searchResponse = await this.searchClient.search(
          plannedQuery.query,
          plannedQuery.provider_hints,
          signal,
        );
        signal?.throwIfAborted();
        providerWarnings.push(...searchResponse.provider_warnings);
        await onProgress?.({
          stage: searchStage,
          status: "completed",
          messageKey: `discovery.${searchStage}.completed`,
          messageText: "Public source search finished.",
          payload: {
            intent: plannedQuery.intent,
            result_count: searchResponse.results.length,
            provider_warnings: searchResponse.provider_warnings,
          },
        });
        const sourceStartIndex = sourceCandidates.length;
        await onProgress?.({
          stage: "filtering",
          status: "started",
          messageKey: "discovery.filtering.started",
          messageText: "Filtering weak or unrelated results.",
          payload: { intent: plannedQuery.intent },
        });
        const filtered = this.matchFilter.filter({
          dto,
          intent: plannedQuery.intent,
          results: searchResponse.results,
          sourceStartIndex,
        });
        sourceCandidates.push(...filtered.source_refs);
        observationCandidates.push(...filtered.research_observations);
        await onProgress?.({
          stage: "filtering",
          status: "completed",
          messageKey: "discovery.filtering.completed",
          messageText: "Search results were filtered.",
          payload: {
            intent: plannedQuery.intent,
            accepted_count: filtered.accepted_count,
            discarded_count: filtered.discarded_count,
          },
        });
      }

      signal?.throwIfAborted();
      const firstWarning = providerWarnings[0];
      const acceptedSourceCount = sourceCandidates.filter(
        (source) => source.status !== "discarded",
      ).length;
      return this.mapper.toIntelligenceResult({
        status:
          acceptedSourceCount > 0
            ? firstWarning
              ? "partial"
              : "complete"
            : firstWarning
              ? "failed"
              : "partial",
        source_refs: sourceCandidates,
        research_observations: observationCandidates,
        safe_error: firstWarning
          ? safeError(
              firstWarning.code,
              firstWarning.message,
              firstWarning.retryable,
            )
          : undefined,
        knowledge_gaps:
          acceptedSourceCount > 0 || firstWarning
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
      signal?.throwIfAborted();
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
}
