import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { StrategyRepository } from "./strategy.repository";
import { validatePlanShape } from "./strategy-plan.validator";

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

  constructor(
    private readonly strategyRepository: StrategyRepository,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    super();
    this.aiUrl = this.config.get<string>("aiService.url") ?? "http://localhost:8000";
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
    this.logger.log(`[Corr: ${correlationId}] Generating strategy ${strategyId}`);

    try {
      // queued → generating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(strategyId, "generating");
      await this.recordProgress(strategyId, {
        stage: "generating",
        status: "started",
        messageKey: "strategy.generating.started",
        messageText: "Strategy generation started.",
        payload: { retrieval_run_id: retrievalRunId, correlation_id: correlationId },
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/generate`,
          { strategy_id: strategyId, retrieval_run_id: retrievalRunId, correlation_id: correlationId },
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
      validatePlanShape(planData);
      assertLanguageValidationPassed(response.data.validation);

      this.logger.log(`[Corr: ${correlationId}] Generation complete — validating`);
      // generating → validating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(strategyId, "validating");
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
      await this.safeFail(strategyId, correlationId, "strategy.generating.failed");
      // Re-throw so BullMQ applies its bounded retries / moves the job to failed.
      throw error;
    }
  }

  // ── Revision ────────────────────────────────────────────────────────
  // Issue requirement: "Revision creates a new retrieval run and immutable
  // version. A failed revision never destroys the previous draft." The
  // revision job MUST run retrieval first, then generate. The prior draft is
  // preserved because appendStrategyVersion only writes a new row.

  private async handleRevise(job: Job<ReviseJobData>) {
    const { strategyId, priorVersionId, feedback, correlationId } = job.data;
    this.logger.log(
      `[Corr: ${correlationId}] Revising strategy ${strategyId} (prior: ${priorVersionId})`,
    );

    // ready → retrieving (FSM-validated). The service claimed draft → ready
    // before enqueuing, so the strategy is expected to be "ready" here.
    let retrievalRunId: string;
    try {
      await this.strategyRepository.updateStrategyStatus(strategyId, "retrieving");
      await this.recordProgress(strategyId, {
        stage: "retrieval",
        status: "started",
        messageKey: "strategy.revision.retrieval.started",
        messageText: "Re-running retrieval for revision.",
        payload: { correlation_id: correlationId },
      });

      const strategy = await this.strategyRepository.readStrategy(strategyId);
      const brief = strategy?.brief ?? null;
      if (!brief) {
        throw new Error("Strategy brief missing before revision retrieval");
      }

      const retrievalResponse = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/retrieve`,
          {
            strategy_id: strategyId,
            brief,
            profile_version_id: brief.businessProfileVersionId,
            correlation_id: correlationId,
          },
          { timeout: 10_000 },
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
      await this.safeFail(strategyId, correlationId, "strategy.revision.retrieval.failed");
      throw error;
    }

    // Step 2: generate the revised plan.
    try {
      // queued → generating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(strategyId, "generating");
      await this.recordProgress(strategyId, {
        stage: "generating",
        status: "started",
        messageKey: "strategy.revision.generating.started",
        messageText: "Revision generation started.",
        payload: { prior_version_id: priorVersionId },
      });

      const revisionResponse = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/revise`,
          {
            strategy_id: strategyId,
            retrieval_run_id: retrievalRunId,
            prior_version_id: priorVersionId,
            feedback,
            correlation_id: correlationId,
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
      validatePlanShape(planData);
      assertLanguageValidationPassed(revisionResponse.data.validation);

      this.logger.log(
        `[Corr: ${correlationId}] Revision generation complete — validating`,
      );
      // generating → validating (FSM-validated)
      await this.strategyRepository.updateStrategyStatus(strategyId, "validating");
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
      await this.safeFail(strategyId, correlationId, "strategy.revision.generating.failed");
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
      await this.strategyRepository.appendProgressEvent(strategyId, event);
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

function assertLanguageValidationPassed(validation: unknown): void {
  if (
    !validation
    || typeof validation !== "object"
    || typeof (validation as { valid?: unknown }).valid !== "boolean"
    || !Array.isArray((validation as { issues?: unknown }).issues)
  ) {
    throw new Error("AI generation service returned no valid validation result");
  }

  const issues = (validation as { issues: unknown[] }).issues;
  const malformedIssue = issues.some(
    (issue) =>
      !issue
      || typeof issue !== "object"
      || typeof (issue as { code?: unknown }).code !== "string"
      || typeof (issue as { field?: unknown }).field !== "string"
      || typeof (issue as { message?: unknown }).message !== "string",
  );
  if (malformedIssue) {
    throw new Error("AI generation service returned malformed validation issues");
  }

  if (
    issues.some(
      (issue) =>
        (issue as { code: string }).code === "STRATEGY_LANGUAGE_MISMATCH",
    )
  ) {
    throw new Error(
      "AI generation service returned a plan that failed the language gate",
    );
  }
}
