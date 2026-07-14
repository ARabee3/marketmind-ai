import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { IntelligenceResult } from "../discovery-state";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import {
  completedIntelligenceInput,
  failedIntelligenceInput,
} from "./intelligence-outcome";
import { IntelligenceSourceConsolidator } from "./intelligence-source.consolidator";
import {
  IntelligenceObservationCandidate,
  IntelligenceProgressCallback,
  IntelligenceSourceCandidate,
} from "./intelligence.types";
import { EvidenceTriageService } from "./evidence-triage.service";
import { FacebookIntelligenceService } from "./facebook-intelligence.service";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchClientService } from "./search-client.service";
import { SearchProviderWarning } from "./search-result.types";
import { SourceEnrichmentService } from "./source-enrichment.service";
const MAX_QUERIES_PER_RUN = 8;
@Injectable()
export class IntelligenceGathererService {
  constructor(
    private readonly queryPlanner: QueryPlannerService,
    private readonly searchClient: SearchClientService,
    private readonly metadataExtractor: MetadataExtractorService,
    private readonly sourceEnrichment: SourceEnrichmentService,
    private readonly evidenceTriage: EvidenceTriageService,
    private readonly mapper: IntelligenceContractMapper,
    private readonly facebookIntelligence: FacebookIntelligenceService,
    private readonly sourceConsolidator: IntelligenceSourceConsolidator,
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
    const facebookRun = await this.facebookIntelligence.start(
      dto,
      onProgress,
      signal,
    );
    const sourceCandidates: IntelligenceSourceCandidate[] = [];
    const observationCandidates: IntelligenceObservationCandidate[] = [];
    const providerWarnings: SearchProviderWarning[] = [];
    let triageProviderFailed = false;

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
            provider_attempts: searchResponse.provider_attempts,
          },
        });
        await onProgress?.({
          stage: "metadata",
          status: "started",
          messageKey: "discovery.source_enrichment.started",
          messageText: "Checking high-value source pages.",
          payload: {
            intent: plannedQuery.intent,
            phase: "source_enrichment",
            result_count: searchResponse.results.length,
          },
        });
        const enrichedResults = await this.sourceEnrichment.enrich(
          searchResponse.results,
          signal,
        );
        signal?.throwIfAborted();
        await onProgress?.({
          stage: "metadata",
          status: "completed",
          messageKey: "discovery.source_enrichment.completed",
          messageText: "High-value source pages were checked.",
          payload: {
            intent: plannedQuery.intent,
            phase: "source_enrichment",
            result_count: enrichedResults.length,
          },
        });
        const sourceStartIndex = sourceCandidates.length;
        await onProgress?.({
          stage: "filtering",
          status: "started",
          messageKey: "discovery.triage.started",
          messageText: "AI is reviewing search evidence.",
          payload: { intent: plannedQuery.intent, phase: "llm_triage" },
        });
        let filtered;
        try {
          filtered = await this.evidenceTriage.triage(
            {
              dto,
              intent: plannedQuery.intent,
              results: enrichedResults,
              sourceStartIndex,
            },
            signal,
          );
        } catch (error) {
          signal?.throwIfAborted();
          if (!(error instanceof ProviderError)) {
            throw error;
          }
          triageProviderFailed = true;
          await onProgress?.({
            stage: "filtering",
            status: "failed",
            messageKey: "discovery.triage.failed",
            messageText: "AI evidence review failed.",
            payload: {
              intent: plannedQuery.intent,
              phase: "llm_triage",
              error_code: error.code,
              provider_attempts: searchResponse.provider_attempts,
              result_count: enrichedResults.length,
            },
          });
          throw error.code === "AI_TRIAGE_TIMEOUT"
            ? new ProviderError(
                "AI_TRIAGE_PROVIDER_ERROR",
                error.message,
                error.retryable,
              )
            : error;
        }
        sourceCandidates.push(...filtered.source_refs);
        observationCandidates.push(...filtered.research_observations);
        await onProgress?.({
          stage: "filtering",
          status: "completed",
          messageKey: "discovery.triage.completed",
          messageText: "AI evidence review finished.",
          payload: {
            intent: plannedQuery.intent,
            phase: "llm_triage",
            accepted_count: filtered.accepted_count,
            discarded_count: filtered.discarded_count,
          },
        });
      }

      const social = await this.facebookIntelligence.complete(
        facebookRun,
        dto,
        sourceCandidates.length,
        onProgress,
        signal,
      );
      signal?.throwIfAborted();
      providerWarnings.push(...social.provider_warnings);
      sourceCandidates.push(...social.source_refs);
      observationCandidates.push(...social.research_observations);

      signal?.throwIfAborted();
      const consolidated = this.sourceConsolidator.consolidate(
        sourceCandidates,
        observationCandidates,
      );
      return this.mapper.toIntelligenceResult(
        completedIntelligenceInput(consolidated, providerWarnings),
      );
    } catch (error) {
      await this.facebookIntelligence.abort(facebookRun, error);
      signal?.throwIfAborted();
      if (!(error instanceof ProviderError)) {
        throw error;
      }

      const consolidated = this.sourceConsolidator.consolidate(
        sourceCandidates,
        observationCandidates,
      );
      return this.mapper.toIntelligenceResult(
        failedIntelligenceInput(consolidated, error, triageProviderFailed),
      );
    }
  }
}
