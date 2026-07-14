import { Injectable } from "@nestjs/common";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import type { EvidenceTriageMappingResult } from "./evidence-triage.service";
import { EvidenceTriageService } from "./evidence-triage.service";
import type { IntelligenceProgressCallback } from "./intelligence.types";
import { SocialEnrichmentService } from "./social-enrichment.service";
import type { SocialEnrichmentResult } from "./social-enrichment.types";

export type FacebookIntelligenceRun = {
  readonly enabled: boolean;
  readonly result: Promise<SocialEnrichmentResult>;
  readonly abort: (reason?: unknown) => void;
};

export type FacebookIntelligenceResult = EvidenceTriageMappingResult & {
  readonly provider_warnings: SocialEnrichmentResult["provider_warnings"];
};

const EMPTY_SOCIAL_RESULT: SocialEnrichmentResult = {
  candidates: [],
  provider_warnings: [],
  provider_attempts: [],
};

@Injectable()
export class FacebookIntelligenceService {
  constructor(
    private readonly socialEnrichment: SocialEnrichmentService,
    private readonly evidenceTriage: EvidenceTriageService,
  ) {}

  async start(
    dto: StartDiscoveryDto,
    onProgress?: IntelligenceProgressCallback,
    signal?: AbortSignal,
  ): Promise<FacebookIntelligenceRun> {
    const abortController = new AbortController();
    const facebookSignal = signal
      ? AbortSignal.any([signal, abortController.signal])
      : abortController.signal;
    const abort = (reason?: unknown): void => abortController.abort(reason);
    const enabled = this.socialEnrichment.isEnabledFor(dto);
    if (!enabled) {
      return {
        enabled: false,
        result: Promise.resolve(EMPTY_SOCIAL_RESULT),
        abort,
      };
    }

    await onProgress?.({
      stage: "metadata",
      status: "started",
      messageKey: "discovery.facebook_enrichment.started",
      messageText: "Checking the submitted public Facebook Page.",
      payload: { phase: "facebook_enrichment" },
    });
    return {
      enabled: true,
      result: this.socialEnrichment.enrich(dto, facebookSignal),
      abort,
    };
  }

  async abort(run: FacebookIntelligenceRun, reason: unknown): Promise<void> {
    run.abort(reason);
    await run.result.catch(() => undefined);
  }

  async complete(
    run: FacebookIntelligenceRun,
    dto: StartDiscoveryDto,
    sourceStartIndex: number,
    onProgress?: IntelligenceProgressCallback,
    signal?: AbortSignal,
  ): Promise<FacebookIntelligenceResult> {
    const social = await run.result;
    signal?.throwIfAborted();
    if (run.enabled) {
      await this.reportAttempts(social, onProgress);
    }

    const triage = await this.triage(
      social,
      dto,
      sourceStartIndex,
      onProgress,
      signal,
    );
    if (run.enabled) {
      await this.reportCompletion(social, onProgress);
    }
    return { ...triage, provider_warnings: social.provider_warnings };
  }

  private async triage(
    social: SocialEnrichmentResult,
    dto: StartDiscoveryDto,
    sourceStartIndex: number,
    onProgress?: IntelligenceProgressCallback,
    signal?: AbortSignal,
  ): Promise<EvidenceTriageMappingResult> {
    if (social.candidates.length === 0) {
      return emptyTriage();
    }

    await onProgress?.({
      stage: "filtering",
      status: "started",
      messageKey: "discovery.facebook_triage.started",
      messageText: "AI is reviewing Facebook evidence.",
      payload: { intent: "social_profile", phase: "llm_triage" },
    });
    const filtered = await this.evidenceTriage.triage(
      {
        dto,
        intent: "social_profile",
        results: social.candidates,
        sourceStartIndex,
      },
      signal,
    );
    await onProgress?.({
      stage: "filtering",
      status: "completed",
      messageKey: "discovery.facebook_triage.completed",
      messageText: "AI Facebook evidence review finished.",
      payload: {
        intent: "social_profile",
        phase: "llm_triage",
        accepted_count: filtered.accepted_count,
        discarded_count: filtered.discarded_count,
      },
    });
    return filtered;
  }

  private async reportAttempts(
    social: SocialEnrichmentResult,
    onProgress?: IntelligenceProgressCallback,
  ): Promise<void> {
    for (const attempt of social.provider_attempts) {
      const isPage = attempt.provider === "apify_facebook_pages";
      await onProgress?.({
        stage: "metadata",
        status: attempt.outcome === "failed" ? "failed" : "completed",
        messageKey: isPage
          ? "discovery.facebook_page.completed"
          : "discovery.facebook_posts.completed",
        messageText: isPage
          ? "Facebook Page check finished."
          : "Facebook post check finished.",
        payload: {
          phase: "facebook_enrichment",
          provider: attempt.provider,
          outcome: attempt.outcome,
          result_count: attempt.result_count,
          duration_ms: attempt.duration_ms,
          error_code: attempt.error_code ?? null,
        },
      });
    }
  }

  private async reportCompletion(
    social: SocialEnrichmentResult,
    onProgress?: IntelligenceProgressCallback,
  ): Promise<void> {
    const partial = social.provider_warnings.length > 0;
    await onProgress?.({
      stage: "metadata",
      status: partial ? "failed" : "completed",
      messageKey: partial
        ? "discovery.facebook_enrichment.partial"
        : "discovery.facebook_enrichment.completed",
      messageText: partial
        ? "Facebook enrichment finished with limited results."
        : "Facebook enrichment finished.",
      payload: {
        phase: "facebook_enrichment",
        result_count: social.candidates.length,
        provider_attempts: social.provider_attempts,
      },
    });
  }
}

function emptyTriage(): EvidenceTriageMappingResult {
  return {
    source_refs: [],
    research_observations: [],
    accepted_count: 0,
    discarded_count: 0,
  };
}
