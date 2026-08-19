import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
  Injectable,
  Logger,
  BadRequestException,
  Optional,
} from "@nestjs/common";
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
import {
  StrategyKnowledgeUnavailableError,
  strategyRetrievalRunIsUsable,
} from "./strategy-retrieval-readiness";

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

// FastAPI can perform up to three provider/repair attempts inside one Strategy
// request. This timeout covers that whole bounded loop; a shorter timeout can
// abort a healthy repair and start duplicate provider work.
const STRATEGY_AI_GENERATION_TIMEOUT_MS = 150_000;

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
    @Optional()
    private readonly billingEntitlements?: BillingEntitlementsService,
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

      const response = await this.callAiGeneration(
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
            STRATEGY_AI_GENERATION_TIMEOUT_MS,
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
      await this.billingEntitlements?.recordProviderCost(
        strategy.ownerUserId,
        {
          metric: "strategy_cycle",
          logicalArtifactKey: `strategy-cycle:${strategyId}:${retrievalRunId}`,
          businessId: strategy.businessId,
          provider: "ai-service",
          model: null,
          successfulArtifact: true,
          retryCount: job.attemptsMade ?? 0,
        },
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
      // No refund here: points are debited only after the draft version is
      // successfully persisted (see the record call above), so a failure
      // before that point never spent anything.
      const reason = generationFailureReason(error);
      await this.safeFail(
        strategyId,
        correlationId,
        "strategy.generating.failed",
        { code: reason.code ?? undefined, messageText: reason.messageText },
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
    if (!strategyRetrievalRunIsUsable(retrievalRun)) {
      throw new StrategyKnowledgeUnavailableError();
    }

    return { strategy, businessProfile, brief, retrievalRun };
  }

  private async handleRevise(job: Job<ReviseJobData>) {
    const { strategyId, priorVersionId, feedback, correlationId } = job.data;
    this.logger.log(
      `[Corr: ${correlationId}] Revising strategy ${strategyId} (prior: ${priorVersionId})`,
    );

    const ownerStrategy =
      await this.strategyRepository.readStrategy(strategyId);
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

      const retrievalRun =
        await this.strategyRepository.getRetrievalRunById(retrievalRunId);
      if (!strategyRetrievalRunIsUsable(retrievalRun)) {
        throw new StrategyKnowledgeUnavailableError();
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

      const revisionResponse = await this.callAiGeneration(
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
            STRATEGY_AI_GENERATION_TIMEOUT_MS,
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
        await this.billingEntitlements?.recordProviderCost(
          strategy.ownerUserId,
          {
            metric: "strategy_revision",
            logicalArtifactKey: `strategy-revision:${strategyId}:${priorVersionId}:${retrievalRunId}`,
            businessId: strategy.businessId,
            provider: "ai-service",
            model: null,
            successfulArtifact: true,
            retryCount: job.attemptsMade ?? 0,
          },
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
      const reason = generationFailureReason(error);
      await this.safeFail(
        strategyId,
        correlationId,
        "strategy.revision.generating.failed",
        { code: reason.code ?? undefined, messageText: reason.messageText },
      );
      throw error;
    }
  }

  private async safeFail(
    strategyId: string,
    correlationId: string,
    messageKey: string,
    options: { readonly code?: string; readonly messageText?: string } = {},
  ): Promise<void> {
    try {
      await this.strategyRepository.updateStrategyStatus(strategyId, "failed");
      await this.recordProgress(strategyId, {
        stage: "failed",
        status: "failed",
        messageKey,
        messageText: options.messageText ?? "Generation failed.",
        retryable: true,
        payload: {
          correlation_id: correlationId,
          ...(options.code ? { code: options.code } : {}),
        },
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
   * Calls one logical AI generation/revise request and validates its boundary.
   *
   * FastAPI owns the bounded provider loop because it can build targeted
   * repair prompts from deterministic validation issues. Repeating the whole
   * request here would discard that context and could multiply provider calls.
   */
  private async callAiGeneration<T>(
    attempt: () => Promise<T>,
    validate: (result: T) => void,
  ): Promise<T> {
    const result = await attempt();
    validate(result);
    return result;
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
    const response = (
      error as Error & {
        response?: { status?: unknown; data?: unknown };
      }
    ).response;
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
 * Extracts a stable failure code and an owner-readable reason from a
 * generation error so the failed progress event can explain WHY generation
 * stopped instead of showing the generic "Generation failed." text.
 *
 * FastAPI errors carry a detail envelope ({ error_type, message, issues });
 * local gates (e.g. assertPlanApprovable) attach a `code` on the Error.
 */
function generationFailureReason(error: unknown): {
  readonly code: string | null;
  readonly messageText: string;
} {
  const candidate = error as {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly response?: {
      readonly data?: {
        readonly detail?: {
          readonly error_type?: unknown;
          readonly message?: unknown;
          readonly issues?: unknown;
        };
      };
    };
  };

  const detail = candidate.response?.data?.detail;
  if (detail && typeof detail.message === "string" && detail.message.trim()) {
    const issues = Array.isArray(detail.issues) ? detail.issues : [];
    const codes = [
      ...new Set(
        issues
          .map((issue) =>
            issue && typeof issue === "object"
              ? (issue as { code?: unknown }).code
              : undefined,
          )
          .filter((code): code is string => typeof code === "string"),
      ),
    ];
    const code = codes.includes("STRATEGY_BLOCKING_BLOCKER")
      ? "STRATEGY_BLOCKING_BLOCKER"
      : typeof detail.error_type === "string"
        ? detail.error_type
        : (codes[0] ?? null);
    return {
      code,
      messageText:
        codes.length > 0
          ? `${detail.message} (${codes.join(", ")})`
          : detail.message,
    };
  }

  const ownCode = typeof candidate.code === "string" ? candidate.code : null;
  const fallback =
    typeof candidate.message === "string" && candidate.message.trim()
      ? candidate.message
      : "Generation failed.";
  return { code: ownCode, messageText: fallback };
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
  const blockingBlockers = blockers.filter(
    (blocker): blocker is { code?: unknown; severity?: unknown } =>
      blocker !== null &&
      typeof blocker === "object" &&
      !Array.isArray(blocker) &&
      (blocker as { severity?: unknown }).severity === "blocking",
  );
  if (blockingBlockers.length === 0) return;
  const codes = blockingBlockers
    .map((blocker) => blocker.code)
    .filter((code): code is string => typeof code === "string");
  const error = new Error(
    `AI generation service returned a plan that cannot be approved (blocking blockers present${
      codes.length > 0 ? `: ${codes.join(", ")}` : ""
    })`,
  ) as Error & { code?: string };
  error.code = "STRATEGY_BLOCKING_BLOCKER";
  throw error;
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
