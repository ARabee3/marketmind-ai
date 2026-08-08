import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger, BadRequestException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { StrategyRepository } from "./strategy.repository";
import { validatePlanShape } from "./strategy-plan.validator";
import {
  buildBusinessProfilePayload,
  buildContractBrief,
  buildRetrievalQueryContext,
  toContractRetrievalPack,
  toRagRetrievalPack,
} from "./strategy-ai-contract";
import { DEFAULT_AI_REQUEST_TIMEOUT_MS } from "../../common/config/external-provider.config";
import { BillingEntitlementsService } from "../billing/billing-entitlements.service";
import { StrategyProgressGateway } from "./strategy-progress.gateway";

/**
 * Extracts the owner-selected channels from a contract brief when it is a
 * strategy-v2 brief (#135). Returns undefined for v1 briefs so the v2 exact
 * commitment check is only enforced on v2 plans.
 */
function extractBriefChannelChoices(
  brief: Record<string, unknown>,
): string[] | undefined {
  const choices = brief["channel_choices"];
  if (!Array.isArray(choices)) return undefined;
  const channels = choices
    .map((choice) =>
      choice && typeof choice === "object"
        ? (choice as { channel?: unknown }).channel
        : undefined,
    )
    .filter((channel): channel is string => typeof channel === "string");
  return channels.length > 0 ? channels : undefined;
}

interface GenerateJobData {
  strategyId: string;
  retrievalRunId: string;
  correlationId: string;
}

interface ReviseJobData {
  strategyId: string;
  priorVersionId: string;
  feedback?: string;
  correlationId: string;
}

@Processor("strategy-generation")
@Injectable()
export class StrategyProcessor extends WorkerHost {
  private readonly logger = new Logger(StrategyProcessor.name);
  private readonly aiUrl: string;
  private readonly aiRequestTimeoutMs: number;

  constructor(
    private readonly strategyRepository: StrategyRepository,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly progressGateway: StrategyProgressGateway,
    @Optional() private readonly billingEntitlements?: BillingEntitlementsService,
  ) {
    super();
    this.aiUrl =
      this.config.get<string>("aiService.url") ?? "http://localhost:8000";
    this.aiRequestTimeoutMs =
      this.config.get<number>("aiService.requestTimeoutMs") ??
      DEFAULT_AI_REQUEST_TIMEOUT_MS;
  }

  async process(job: Job<unknown, unknown, string>): Promise<unknown> {
    switch (job.name) {
      case "generate-strategy":
        return this.handleGenerate(job as unknown as Job<GenerateJobData>);
      case "revise-strategy":
        return this.handleRevise(job as unknown as Job<ReviseJobData>);
      default:
        this.logger.warn(`[Processor] Unknown job type: ${job.name}`);
        return;
    }
  }

  // ── Generation ──────────────────────────────────────────────────────

  private async handleGenerate(job: Job<GenerateJobData>) {
    const { strategyId, retrievalRunId, correlationId } = job.data;
    this.logger.log(
      `[Corr: ${correlationId}] Generating strategy ${strategyId}`,
    );

    try {
      // queued → generating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(
        strategyId,
        "generating",
      );
      await this.recordProgress(strategyId, {
        stage: "generating",
        status: "started",
        messageKey: "strategy.generating.started",
        messageText: "Strategy generation started.",
        payload: {
          retrieval_run_id: retrievalRunId,
          correlation_id: correlationId,
        },
      });

      const { strategy, businessProfile, brief, retrievalRun } =
        await this.loadGenerationInputs(strategyId, retrievalRunId);
      await this.billingEntitlements?.assertAllowed(
        strategy.ownerUserId,
        "strategy_cycle",
        1,
      );
      const contractBrief = buildContractBrief(brief, businessProfile);
      const businessProfilePayload =
        buildBusinessProfilePayload(businessProfile);

      // Deterministic scoring must run first: the generate endpoint requires
      // the precomputed channel scorecards so the plan reuses them verbatim.
      const scoreResponse = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/score`,
          {
            business_profile: businessProfilePayload,
            brief: contractBrief,
            retrieval_pack: toRagRetrievalPack(retrievalRun),
          },
          { timeout: 30_000 },
        ),
      );
      const deterministicChannelScores =
        scoreResponse.data?.deterministic_channel_scores;
      if (!Array.isArray(deterministicChannelScores)) {
        throw new Error(
          "AI scoring service returned no deterministic_channel_scores",
        );
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/generate`,
          {
            contract_version: "strategy-v1",
            strategy_id: strategyId,
            business_profile: businessProfilePayload,
            brief: contractBrief,
            retrieved_knowledge_pack: toContractRetrievalPack(retrievalRun),
            deterministic_channel_scores: deterministicChannelScores,
          },
          { timeout: 45_000 },
        ),
      );

      const planData = response.data.plan;
      const promptConfig = response.data.prompt_config ?? {};

      if (!planData) {
        throw new Error("AI generation service returned no plan");
      }

      // Structural validation gate — catches malformed provider responses
      // before persisting an immutable version.
      validatePlanShape(planData, extractBriefChannelChoices(contractBrief));
      assertStrategyValidationPassed(response.data.validation);

      this.logger.log(
        `[Corr: ${correlationId}] Generation complete — validating`,
      );
      // generating → validating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(
        strategyId,
        "validating",
      );
      await this.recordProgress(strategyId, {
        stage: "validating",
        status: "started",
        messageKey: "strategy.validating",
        messageText: "Persisting immutable draft version.",
      });

      // validating → draft inside the transaction (FSM-validated)
      const version = await this.strategyRepository.appendStrategyVersion(
        strategyId,
        retrievalRunId,
        planData,
        promptConfig,
      );
      await this.billingEntitlements?.record(
        strategy.ownerUserId,
        "strategy_cycle",
        1,
        `strategy-cycle:${strategyId}:${retrievalRunId}`,
        strategy.businessId,
      );

      this.logger.log(
        `[Corr: ${correlationId}] Saved StrategyVersion ${version.id} (→ draft)`,
      );
      await this.recordProgress(strategyId, {
        stage: "ready",
        status: "complete",
        messageKey: "strategy.draft.ready",
        messageText: `Draft version ${version.version} ready for owner review.`,
        payload: { version_id: version.id, version_number: version.version },
      });
      return { success: true, versionId: version.id };
    } catch (error: unknown) {
      this.logger.error(
        `[Corr: ${correlationId}] Generation failed: ${errorMessage(error)}`,
      );
      await this.safeFail(
        strategyId,
        correlationId,
        "strategy.generating.failed",
      );
      // Re-throw so the job moves to failed in the queue. Retries are
      // owner-initiated via POST /:id/retry (failed → ready → ...), which is the
      // only FSM-legal recovery path; the job itself never auto-retries.
      throw error;
    }
  }

  // ── Revision ────────────────────────────────────────────────────────
  // Issue requirement: "Revision creates a new retrieval run and immutable
  // version. A failed revision never destroys the previous draft." The
  // revision job MUST run retrieval first, then generate. The prior draft is
  // preserved because appendStrategyVersion only writes a new row.

  private async loadGenerationInputs(
    strategyId: string,
    retrievalRunId: string,
  ) {
    const strategy = await this.strategyRepository.readStrategy(strategyId);
    const brief = strategy?.brief ?? null;
    const business = strategy?.business ?? null;
    if (!brief) {
      throw new Error("Strategy brief missing during generation");
    }
    if (!business) {
      throw new Error("Strategy business missing during generation");
    }

    const businessProfile = await this.strategyRepository.getProfileVersionById(
      brief.businessProfileVersionId,
    );
    if (!businessProfile) {
      throw new Error("Business profile version missing during generation");
    }

    const retrievalRun =
      await this.strategyRepository.getRetrievalRunById(retrievalRunId);
    if (!retrievalRun) {
      throw new Error("Retrieval run missing during generation");
    }

    return { strategy, businessProfile, brief, retrievalRun };
  }

  private async handleRevise(job: Job<ReviseJobData>) {
    const { strategyId, priorVersionId, feedback, correlationId } = job.data;
    this.logger.log(
      `[Corr: ${correlationId}] Revising strategy ${strategyId} (prior: ${priorVersionId})`,
    );

    const ownerStrategy = await this.strategyRepository.readStrategy(strategyId);
    if (ownerStrategy) {
      await this.billingEntitlements?.assertAllowed(
        ownerStrategy.ownerUserId,
        "strategy_revision",
        1,
      );
    }

    // ready → retrieving (FSM-validated). The service claimed draft → ready
    // before enqueuing, so the strategy is expected to be "ready" here.
    let retrievalRunId: string;
    try {
      await this.strategyRepository.updateStrategyStatus(
        strategyId,
        "retrieving",
      );
      await this.recordProgress(strategyId, {
        stage: "retrieval",
        status: "started",
        messageKey: "strategy.revision.retrieval.started",
        messageText: "Re-running retrieval for revision.",
        payload: { correlation_id: correlationId },
      });

      const strategy = await this.strategyRepository.readStrategy(strategyId);
      const brief = strategy?.brief ?? null;
      const business = strategy?.business ?? null;
      if (!brief) {
        throw new Error("Strategy brief missing before revision retrieval");
      }
      if (!business) {
        throw new Error("Strategy business missing before revision retrieval");
      }

      const profileVersion =
        await this.strategyRepository.getProfileVersionById(
          brief.businessProfileVersionId,
        );
      if (!profileVersion) {
        throw new Error(
          "Business profile version missing before revision retrieval",
        );
      }

      const retrievalResponse = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/retrieve`,
          buildRetrievalQueryContext(brief, profileVersion, business),
          {
            params: {
              strategy_id: strategyId,
              brief_id: brief.id,
              profile_version_id: brief.businessProfileVersionId,
            },
            timeout: this.aiRequestTimeoutMs,
          },
        ),
      );

      retrievalRunId = retrievalResponse.data.retrieval_run_id;
      if (!retrievalRunId) {
        throw new Error("AI retrieval service returned no retrieval_run_id");
      }

      this.logger.log(
        `[Corr: ${correlationId}] Revision retrieval complete. Run: ${retrievalRunId}`,
      );
      // retrieving → queued (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(strategyId, "queued");
      await this.recordProgress(strategyId, {
        stage: "retrieval",
        status: "complete",
        messageKey: "strategy.revision.retrieval.complete",
        messageText: "Revision retrieval complete.",
        payload: { retrieval_run_id: retrievalRunId },
      });
    } catch (error: unknown) {
      this.logger.error(
        `[Corr: ${correlationId}] Revision retrieval failed: ${errorMessage(error)}`,
      );
      await this.safeFail(
        strategyId,
        correlationId,
        "strategy.revision.retrieval.failed",
      );
      throw error;
    }

    // Step 2: generate the revised plan.
    try {
      // queued → generating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(
        strategyId,
        "generating",
      );
      await this.recordProgress(strategyId, {
        stage: "generating",
        status: "started",
        messageKey: "strategy.revision.generating.started",
        messageText: "Revision generation started.",
        payload: { prior_version_id: priorVersionId },
      });

      const strategy = await this.strategyRepository.readStrategy(strategyId);
      const brief = strategy?.brief ?? null;
      if (!brief) {
        throw new Error("Strategy brief missing before revision generation");
      }

      const profileVersion =
        await this.strategyRepository.getProfileVersionById(
          brief.businessProfileVersionId,
        );
      if (!profileVersion) {
        throw new Error(
          "Business profile version missing before revision generation",
        );
      }

      const retrievalRun =
        await this.strategyRepository.getRetrievalRunById(retrievalRunId);
      if (!retrievalRun) {
        throw new Error("Retrieval run missing before revision generation");
      }

      const priorVersion =
        await this.strategyRepository.getVersionById(priorVersionId);
      if (!priorVersion) {
        throw new Error(
          "Prior strategy version missing before revision generation",
        );
      }

      const contractBrief = buildContractBrief(brief, profileVersion);
      const businessProfilePayload =
        buildBusinessProfilePayload(profileVersion);

      // Deterministic scoring must run first: the revise endpoint requires the
      // precomputed channel scorecards so the revised plan reuses them verbatim.
      const scoreResponse = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/score`,
          {
            business_profile: businessProfilePayload,
            brief: contractBrief,
            retrieval_pack: toRagRetrievalPack(retrievalRun),
          },
          { timeout: 30_000 },
        ),
      );
      const deterministicChannelScores =
        scoreResponse.data?.deterministic_channel_scores;
      if (!Array.isArray(deterministicChannelScores)) {
        throw new Error(
          "AI scoring service returned no deterministic_channel_scores",
        );
      }

      const revisionResponse = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/revise`,
          {
            contract_version: "strategy-v1",
            strategy_id: strategyId,
            business_profile: businessProfilePayload,
            brief: contractBrief,
            retrieved_knowledge_pack: toContractRetrievalPack(retrievalRun),
            deterministic_channel_scores: deterministicChannelScores,
            previous_plan: priorVersion.planData,
            revision_notes: feedback?.trim() || "",
          },
          { timeout: 45_000 },
        ),
      );

      const planData = revisionResponse.data.plan;
      const promptConfig = revisionResponse.data.prompt_config ?? {};

      if (!planData) {
        throw new Error("AI revision service returned no plan");
      }

      // Structural validation gate — catches malformed provider responses
      // before persisting an immutable version.
      validatePlanShape(planData, extractBriefChannelChoices(contractBrief));
      assertStrategyValidationPassed(revisionResponse.data.validation);

      this.logger.log(
        `[Corr: ${correlationId}] Revision generation complete — validating`,
      );
      // generating → validating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(
        strategyId,
        "validating",
      );
      await this.recordProgress(strategyId, {
        stage: "validating",
        status: "started",
        messageKey: "strategy.revision.validating",
        messageText: "Persisting immutable revised draft version.",
      });

      // validating → draft inside the transaction, preserving the prior draft.
      const version = await this.strategyRepository.appendStrategyVersion(
        strategyId,
        retrievalRunId,
        planData,
        promptConfig,
      );
      if (strategy) {
        await this.billingEntitlements?.record(
          strategy.ownerUserId,
          "strategy_revision",
          1,
          `strategy-revision:${strategyId}:${priorVersionId}:${retrievalRunId}`,
          strategy.businessId,
        );
      }

      this.logger.log(
        `[Corr: ${correlationId}] Saved revised StrategyVersion ${version.id} (→ draft)`,
      );
      await this.recordProgress(strategyId, {
        stage: "ready",
        status: "complete",
        messageKey: "strategy.revision.draft.ready",
        messageText: `Revised draft version ${version.version} ready for owner review.`,
        payload: {
          version_id: version.id,
          version_number: version.version,
          prior_version_id: priorVersionId,
        },
      });
      return { success: true, versionId: version.id };
    } catch (error: unknown) {
      this.logger.error(
        `[Corr: ${correlationId}] Revision generation failed: ${errorMessage(error)}`,
      );
      // A failed revision MUST NOT destroy the prior draft. Only the Strategy
      // status is failed; the prior StrategyVersion row is untouched.
      await this.safeFail(
        strategyId,
        correlationId,
        "strategy.revision.generating.failed",
      );
      throw error;
    }
  }

  private async safeFail(
    strategyId: string,
    correlationId: string,
    messageKey: string,
  ): Promise<void> {
    try {
      await this.strategyRepository.updateStrategyStatus(strategyId, "failed");
      await this.recordProgress(strategyId, {
        stage: "failed",
        status: "failed",
        messageKey,
        messageText: "Generation failed.",
        retryable: true,
        payload: { correlation_id: correlationId },
      });
    } catch (transitionError: unknown) {
      // If the transition itself is illegal (e.g. another worker already moved
      // the status), log and continue — the job is being failed anyway.
      if (transitionError instanceof BadRequestException) {
        this.logger.warn(
          `[Corr: ${correlationId}] Could not transition to failed: ${transitionError.message}`,
        );
      } else {
        this.logger.error(
          `[Corr: ${correlationId}] Unexpected error transitioning to failed: ${errorMessage(transitionError)}`,
        );
      }
    }
  }

  private async recordProgress(
    strategyId: string,
    event: Parameters<StrategyRepository["appendProgressEvent"]>[1],
  ): Promise<void> {
    try {
      const savedEvent = await this.strategyRepository.appendProgressEvent(
        strategyId,
        event,
      );
      this.progressGateway.emitProgress(strategyId, savedEvent);
    } catch (error: unknown) {
      this.logger.warn(
        `[Strategy ${strategyId}] Failed to persist progress event: ${errorMessage(error)}`,
      );
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function assertStrategyValidationPassed(validation: unknown): void {
  if (
    !validation ||
    typeof validation !== "object" ||
    typeof (validation as { valid?: unknown }).valid !== "boolean" ||
    !Array.isArray((validation as { issues?: unknown }).issues)
  ) {
    throw new Error(
      "AI generation service returned no valid validation result",
    );
  }

  const issues = (validation as { issues: unknown[] }).issues;
  const malformedIssue = issues.some(
    (issue) =>
      !issue ||
      typeof issue !== "object" ||
      typeof (issue as { code?: unknown }).code !== "string" ||
      typeof (issue as { field?: unknown }).field !== "string" ||
      typeof (issue as { message?: unknown }).message !== "string",
  );
  if (malformedIssue) {
    throw new Error(
      "AI generation service returned malformed validation issues",
    );
  }

  const hasLanguageMismatch = issues.some(
    (issue) =>
      (issue as { code: string }).code === "STRATEGY_LANGUAGE_MISMATCH",
  );
  if (hasLanguageMismatch) {
    throw new Error(
      "AI generation service returned a plan that failed the language gate",
    );
  }

  if (!(validation as { valid: boolean }).valid) {
    throw new Error(
      "AI generation service returned a plan that failed Strategy validation",
    );
  }
}
