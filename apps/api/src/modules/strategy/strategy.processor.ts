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

/**
 * Total attempts (including the first) for a single AI generation/revise
 * call. Each attempt already includes the AI service's own bounded
 * generation retries, so this loop is the outer safety net.
 */
const MAX_AI_GENERATION_ATTEMPTS = 3;

/** Base backoff delay between AI generation attempts (doubles per attempt). */
const DEFAULT_AI_GENERATION_RETRY_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Processor("strategy-generation")
@Injectable()
export class StrategyProcessor extends WorkerHost {
  private readonly logger = new Logger(StrategyProcessor.name);
  private readonly aiUrl: string;
  private readonly aiRequestTimeoutMs: number;
  private readonly aiGenerationRetryDelayMs: number;

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
    this.aiGenerationRetryDelayMs =
      this.config.get<number>("aiService.generationRetryDelayMs") ??
      DEFAULT_AI_GENERATION_RETRY_DELAY_MS;
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
      const contractVersion = strategy.contractVersion;
      const contractBrief = buildContractBrief(
        brief,
        businessProfile,
        contractVersion,
      );
      const businessProfilePayload =
        buildBusinessProfilePayload(businessProfile);

      // Deterministic scoring must run first: the generate endpoint requires
      // the precomputed channel scorecards so the plan reuses them verbatim.
      const scoreResponse = await this.postAi(
        "/internal/v1/ai/strategy/score",
        {
          business_profile: businessProfilePayload,
          brief: contractBrief,
          retrieval_pack: toRagRetrievalPack(retrievalRun),
        },
        30_000,
        correlationId,
      );
      const deterministicChannelScores =
        scoreResponse.data?.deterministic_channel_scores;
      if (!Array.isArray(deterministicChannelScores)) {
        throw new Error(
          "AI scoring service returned no deterministic_channel_scores",
        );
      }

      const response = await this.callAiGenerationWithRetry(
        correlationId,
        () =>
          this.postAi(
            "/internal/v1/ai/strategy/generate",
            {
              contract_version: contractVersion,
              strategy_id: strategyId,
              business_profile: businessProfilePayload,
              brief: contractBrief,
              retrieved_knowledge_pack: toContractRetrievalPack(retrievalRun),
              deterministic_channel_scores: deterministicChannelScores,
            },
            45_000,
            correlationId,
          ),
        (result) => {
          const planData = result.data?.plan;
          if (!planData) {
            throw new Error("AI generation service returned no plan");
          }
          // Structural validation gate — catches malformed provider responses
          // before persisting an immutable version.
          validatePlanShape(planData);
          assertStrategyValidationPassed(result.data.validation);
          assertPlanApprovable(planData);
        },
      );

      const planData = response.data.plan;
      const promptConfig = response.data.prompt_config ?? {};

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

      const retrievalResponse = await this.postAi(
        "/internal/v1/ai/strategy/retrieve",
        buildRetrievalQueryContext(brief, profileVersion, business),
        this.aiRequestTimeoutMs,
        correlationId,
        {
          params: {
            strategy_id: strategyId,
            brief_id: brief.id,
            profile_version_id: brief.businessProfileVersionId,
          },
        },
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

      const contractBrief = buildContractBrief(
        brief,
        profileVersion,
        strategy.contractVersion,
      );
      const businessProfilePayload =
        buildBusinessProfilePayload(profileVersion);

      // Deterministic scoring must run first: the revise endpoint requires the
      // precomputed channel scorecards so the revised plan reuses them verbatim.
      const scoreResponse = await this.postAi(
        "/internal/v1/ai/strategy/score",
        {
          business_profile: businessProfilePayload,
          brief: contractBrief,
          retrieval_pack: toRagRetrievalPack(retrievalRun),
        },
        30_000,
        correlationId,
      );
      const deterministicChannelScores =
        scoreResponse.data?.deterministic_channel_scores;
      if (!Array.isArray(deterministicChannelScores)) {
        throw new Error(
          "AI scoring service returned no deterministic_channel_scores",
        );
      }

      const revisionResponse = await this.callAiGenerationWithRetry(
        correlationId,
        () =>
          this.postAi(
            "/internal/v1/ai/strategy/revise",
            {
              contract_version: strategy.contractVersion,
              strategy_id: strategyId,
              business_profile: businessProfilePayload,
              brief: contractBrief,
              retrieved_knowledge_pack: toContractRetrievalPack(retrievalRun),
              deterministic_channel_scores: deterministicChannelScores,
              previous_plan: priorVersion.planData,
              revision_notes: feedback?.trim() || "",
            },
            45_000,
            correlationId,
          ),
        (result) => {
          const planData = result.data?.plan;
          if (!planData) {
            throw new Error("AI revision service returned no plan");
          }
          // Structural validation gate — catches malformed provider responses
          // before persisting an immutable version.
          validatePlanShape(planData);
          assertStrategyValidationPassed(result.data.validation);
          assertPlanApprovable(planData);
        },
      );

      const planData = revisionResponse.data.plan;
      const promptConfig = revisionResponse.data.prompt_config ?? {};

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

  /**
   * Calls the AI generation/revise endpoint with bounded automatic retries.
   *
   * Owner-facing rule: a draft is only ever surfaced when it is valid AND
   * approvable. Transient provider errors, HTTP 422 validation rejections,
   * malformed responses, and plans that carry blocking blockers are all
   * retried automatically while the strategy stays in `generating`. The
   * strategy only moves to `failed` (owner-visible retry) after every attempt
   * is exhausted.
   */
  private async callAiGenerationWithRetry<T>(
    correlationId: string,
    attempt: () => Promise<T>,
    validate: (result: T) => void,
  ): Promise<T> {
    let lastError: unknown = new Error("AI generation failed");
    for (
      let attemptNumber = 0;
      attemptNumber < MAX_AI_GENERATION_ATTEMPTS;
      attemptNumber += 1
    ) {
      try {
        const result = await attempt();
        validate(result);
        return result;
      } catch (error: unknown) {
        lastError = error;
        const hasRetriesLeft = attemptNumber < MAX_AI_GENERATION_ATTEMPTS - 1;
        if (hasRetriesLeft && shouldRetryAiGeneration(error)) {
          const delay = this.aiGenerationRetryDelayMs * 2 ** attemptNumber;
          this.logger.warn(
            `[Corr: ${correlationId}] AI generation attempt ${attemptNumber + 1}/${MAX_AI_GENERATION_ATTEMPTS} failed (${errorMessage(error)}); retrying in ${delay}ms`,
          );
          await sleep(delay);
        }
      }
    }
    throw lastError;
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

  private async postAi(
    path: string,
    payload: unknown,
    timeout: number,
    correlationId: string,
    options: Record<string, unknown> = {},
  ) {
    try {
      return await firstValueFrom(
        this.httpService.post(`${this.aiUrl}${path}`, payload, {
          ...options,
          timeout,
        }),
      );
    } catch (error: unknown) {
      this.logger.error(
        `[Corr: ${correlationId}] AI request ${path} failed: ${errorMessage(error)}`,
      );
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const response = (error as Error & {
      response?: { status?: unknown; data?: unknown };
    }).response;
    if (response?.status !== undefined) {
      const detail = formatResponseData(response.data);
      return `${error.message} (status=${String(response.status)}${detail ? `, response=${detail}` : ""})`;
    }
    return error.message;
  }
  return String(error);
}

function formatResponseData(data: unknown): string {
  if (data === undefined) return "";
  const serialized = typeof data === "string" ? data : JSON.stringify(data);
  if (!serialized) return "";
  return serialized.length > 2_000
    ? `${serialized.slice(0, 2_000)}…`
    : serialized;
}

/**
 * Decides whether an AI generation attempt is worth repeating. Retries are
 * bounded and safe for transient provider failures, HTTP 422 validation
 * rejections (the AI service itself re-attempts with repair prompts), and
 * plans that are structurally invalid or non-approvable. Other HTTP 4xx
 * responses (e.g. a malformed request body) will not fix themselves and are
 * surfaced immediately.
 */
function shouldRetryAiGeneration(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const status = (error as Error & { response?: { status?: number } })
    .response?.status;
  if (typeof status === "number") {
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      return false;
    }
    return true;
  }
  return true;
}

/**
 * Owner-approvability gate. A plan can pass the contract validation pipeline
 * and still carry `blocking` blockers (e.g. an unresolved capability or a
 * budget constraint the owner cannot approve past). Such a plan can never be
 * approved, so it must never be shown to the owner as a ready draft —
 * regeneration is retried instead.
 */
function assertPlanApprovable(planData: unknown): void {
  if (!planData || typeof planData !== "object" || Array.isArray(planData)) {
    throw new Error("AI generation service returned no plan");
  }
  const blockers = (planData as { blockers?: unknown }).blockers;
  if (!Array.isArray(blockers)) return;
  const hasBlockingBlocker = blockers.some(
    (blocker) =>
      blocker !== null &&
      typeof blocker === "object" &&
      !Array.isArray(blocker) &&
      (blocker as { severity?: unknown }).severity === "blocking",
  );
  if (hasBlockingBlocker) {
    throw new Error(
      "AI generation service returned a plan that cannot be approved (blocking blockers present)",
    );
  }
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
