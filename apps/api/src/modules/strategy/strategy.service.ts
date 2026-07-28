import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { randomUUID } from "crypto";
import { StrategyRepository } from "./strategy.repository";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { UpsertBriefDto } from "./dto/upsert-brief.dto";
import { OwnerDecisionDto } from "./dto/owner-decision.dto";

/** Owner-initiated retry limit (distinct from BullMQ queue-level job retries). */
const MAX_OWNER_RETRIES = 3;

/** Strategy statuses from which a new generation run may legally start. */
const GENERATION_IDLE: Array<"ready"> = ["ready"];

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private readonly aiUrl: string;

  constructor(
    private readonly strategyRepository: StrategyRepository,
    @InjectQueue("strategy-generation") private readonly strategyQueue: Queue,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiUrl = this.config.get<string>("aiService.url") ?? "http://localhost:8000";
  }

  // ── POST /api/v1/strategies ─────────────────────────────────────────

  async createStrategy(dto: CreateStrategyDto, ownerUserId: string) {
    const profile = await this.strategyRepository.getActiveConfirmedProfileVersion(
      dto.businessId,
    );
    if (!profile) {
      throw new BadRequestException(
        "No confirmed business profile found for this business.",
      );
    }
    return this.strategyRepository.createStrategy(dto.businessId, ownerUserId);
  }

  // ── PUT /api/v1/strategies/:id/brief ───────────────────────────────

  async upsertBrief(id: string, ownerUserId: string, dto: UpsertBriefDto) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found or unauthorized");

    // Persist brief keyed on owner-confirmed profile version. @IsUUID on the dto
    // guards the value shape; the FK constraint guards existence.
    const brief = await this.strategyRepository.upsertBrief(id, dto as never);

    if (this.isBriefReady(brief) && strategy.status === "needs_brief") {
      // needs_brief → ready is the only legal readiness transition.
      await this.strategyRepository.updateStrategyStatus(id, "ready");
      await this.recordProgress(id, {
        stage: "ready",
        status: "complete",
        messageKey: "strategy.brief.ready",
        messageText: "Strategy brief is complete; generation unlocked.",
      });
    }

    return brief;
  }

  private isBriefReady(brief: {
    primaryObjective: string;
    startDate: Date | string;
    planLanguage: string;
    externalBudgetMode: string;
    teamCapacity: string;
  }): boolean {
    return !!(
      brief.primaryObjective &&
      brief.startDate &&
      brief.planLanguage &&
      brief.externalBudgetMode &&
      brief.teamCapacity
    );
  }

  // ── POST /api/v1/strategies/:id/generate ───────────────────────────

  async startGeneration(id: string, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy || !strategy.brief) {
      throw new NotFoundException("Strategy or brief not found");
    }

    // Atomic idempotency guard: a single conditional transition to "retrieving"
    // rejects any concurrent duplicate request before enqueuing a job or
    // spending any provider call.
    const { claimed } = await this.strategyRepository.claimForGeneration(
      id,
      GENERATION_IDLE,
      "retrieving",
    );
    if (!claimed) {
      throw new BadRequestException(
        "Generation is already in progress or not permitted from the current status",
      );
    }

    // Stale-profile detection — must run AFTER the claim so a duplicate request
    // cannot enqueue against an outdated profile.
    const latestProfile = await this.strategyRepository.getActiveConfirmedProfileVersion(
      strategy.businessId,
    );
    if (
      !latestProfile ||
      latestProfile.id !== strategy.brief.businessProfileVersionId
    ) {
      // Roll the claim back to "failed" so the owner can re-brief and retry.
      await this.strategyRepository.updateStrategyStatus(id, "failed");
      await this.recordProgress(id, {
        stage: "failed",
        status: "failed",
        messageKey: "strategy.stale_profile",
        messageText: "Business profile has been updated since this brief.",
        payload: { code: "STALE_PROFILE", retryable: false },
      });
      throw new BadRequestException({
        code: "STALE_PROFILE",
        message:
          "The business profile has been updated since this brief was created. Please review and re-confirm.",
        latestProfileVersionId: latestProfile?.id ?? null,
      });
    }

    const correlationId = randomUUID();
    this.logger.log(
      `[Strategy ${id}] [Corr: ${correlationId}] Starting retrieval.`,
    );
    await this.recordProgress(id, {
      stage: "retrieval",
      status: "started",
      messageKey: "strategy.retrieval.started",
      messageText: "Knowledge retrieval started.",
      payload: { correlation_id: correlationId },
    });

    try {
      const payload = {
        strategy_id: strategy.id,
        brief: strategy.brief,
        profile_version_id: strategy.brief.businessProfileVersionId,
        correlation_id: correlationId,
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.aiUrl}/internal/v1/ai/strategy/retrieve`, payload, {
          timeout: 10_000,
        }),
      );

      const { retrieval_run_id } = response.data;
      if (!retrieval_run_id) {
        throw new Error("AI retrieval service returned no retrieval_run_id");
      }

      this.logger.log(
        `[Strategy ${id}] [Corr: ${correlationId}] Retrieval complete. Run: ${retrieval_run_id}. Queuing generation.`,
      );
      await this.recordProgress(id, {
        stage: "retrieval",
        status: "complete",
        messageKey: "strategy.retrieval.complete",
        messageText: "Knowledge retrieval complete.",
        payload: { retrieval_run_id, correlation_id: correlationId },
      });

      await this.strategyQueue.add(
        "generate-strategy",
        { strategyId: id, retrievalRunId: retrieval_run_id, correlationId },
        { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
      );

      await this.strategyRepository.updateStrategyStatus(id, "queued");
      await this.recordProgress(id, {
        stage: "queued",
        status: "started",
        messageKey: "strategy.queued",
        messageText: "Generation job queued.",
        payload: { correlation_id: correlationId },
      });

      return { status: "queued", correlationId };
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.logger.error(
        `[Strategy ${id}] [Corr: ${correlationId}] Retrieval failed: ${message}`,
      );
      // Transition back to failed so the client can retry with bounded policy.
      await this.strategyRepository.updateStrategyStatus(id, "failed");
      await this.recordProgress(id, {
        stage: "failed",
        status: "failed",
        messageKey: "strategy.retrieval.failed",
        messageText: "Knowledge retrieval failed.",
        payload: { code: "RETRIEVAL_FAILED", retryable: isRetryable(error) },
      });

      throw new InternalServerErrorException({
        message: "Failed to retrieve knowledge pack",
        retryable: isRetryable(error),
      });
    }
  }

  // ── GET /api/v1/strategies/:id ──────────────────────────────────────

  async getStrategy(id: string, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");
    return strategy;
  }

  // ── GET /api/v1/strategies/:id/versions/:version ───────────────────

  async getStrategyVersion(id: string, version: number, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    const v = await this.strategyRepository.getVersionByNumber(id, version);
    if (!v) throw new NotFoundException(`Strategy version ${version} not found`);
    return v;
  }

  // ── GET /api/v1/strategies/:id/retrieval ───────────────────────────

  async getRetrievalPack(id: string, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    const run = await this.strategyRepository.getLatestRetrievalRun(id);
    if (!run) throw new NotFoundException("No retrieval pack found for this strategy");
    return run;
  }

  // ── POST /api/v1/strategies/:id/decisions ──────────────────────────

  async handleDecision(id: string, ownerUserId: string, dto: OwnerDecisionDto) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    if (strategy.status !== "draft") {
      throw new BadRequestException("Decisions can only be made on a draft strategy");
    }

    // Atomic idempotency: claim via the terminal transition so a concurrent
    // duplicate approve/reject cannot both succeed.
    if (dto.action === "revision_requested") {
      // transition draft → ready is the legal revising path. claim atomically.
      const { claimed } = await this.strategyRepository.claimForGeneration(
        id,
        ["draft"],
        "ready",
      );
      if (!claimed) {
        throw new BadRequestException(
          "A decision or revision is already in progress",
        );
      }

      await this.recordProgress(id, {
        stage: "ready",
        status: "started",
        messageKey: "strategy.revision_requested",
        messageText: "Owner requested a revision.",
        payload: { prior_version_id: dto.versionId, feedback: dto.feedback },
      });

      const decision = await this.strategyRepository.recordOwnerDecision(
        dto.versionId,
        ownerUserId,
        dto.action,
        dto.feedback,
      );

      const correlationId = randomUUID();
      await this.strategyQueue.add(
        "revise-strategy",
        {
          strategyId: id,
          priorVersionId: dto.versionId,
          feedback: dto.feedback,
          correlationId,
        },
        { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
      );

      this.logger.log(
        `[Strategy ${id}] [Corr: ${correlationId}] Revision requested. Prior version: ${dto.versionId}`,
      );

      return { decision, correlationId };
    }

    // approve / reject — recordOwnerDecision enforces FSM + transitions atomically.
    const { decision, nextStatus } = await this.strategyRepository.recordOwnerDecision(
      dto.versionId,
      ownerUserId,
      dto.action,
      dto.feedback,
    );

    if (nextStatus) {
      await this.recordProgress(id, {
        stage: nextStatus,
        status: "complete",
        messageKey:
          nextStatus === "approved"
            ? "strategy.approved"
            : "strategy.rejected",
        messageText:
          nextStatus === "approved"
            ? "Strategy plan approved by owner."
            : "Strategy plan rejected by owner.",
      });
    }

    return { decision, nextStatus };
  }

  // ── POST /api/v1/strategies/:id/retry ──────────────────────────────

  async retryGeneration(id: string, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    if (strategy.status !== "failed") {
      throw new BadRequestException("Strategy is not in a failed state");
    }

    // Bounded owner-initiated retries.
    const retryCount = await this.strategyRepository.countRetries(id);
    if (retryCount >= MAX_OWNER_RETRIES) {
      throw new BadRequestException(
        `Maximum retry limit of ${MAX_OWNER_RETRIES} has been reached for this strategy`,
      );
    }

    // Stale-profile re-check on retry — required before resuming. A retried
    // run must not silently proceed against an outdated brief/profile. This
    // runs BEFORE recording the retry decision so a stale-profile rejection
    // does not consume the retry budget.
    const latestProfile = await this.strategyRepository.getActiveConfirmedProfileVersion(
      strategy.businessId,
    );
    if (!strategy.brief || !latestProfile) {
      throw new BadRequestException("Brief or confirmed profile is missing");
    }
    if (latestProfile.id !== strategy.brief.businessProfileVersionId) {
      throw new BadRequestException({
        code: "STALE_PROFILE",
        message:
          "The business profile has been updated since this brief was created. Please review and re-confirm.",
        latestProfileVersionId: latestProfile.id,
      });
    }

    // Audit the retry attempt — only after the stale-profile check passes,
    // so a stale-profile rejection does not consume the retry budget.
    const latestVersion = await this.strategyRepository.getLatestVersion(id);
    if (latestVersion) {
      await this.strategyRepository.recordRetryDecision(latestVersion.id, ownerUserId);
    }

    const latestRun = await this.strategyRepository.getLatestRetrievalRun(id);

    // If a retrieval already succeeded we can resume generation directly, but
    // we still must go through the legal FSM path. failed → ready → queued is
    // a two-hop but performs both atomically via claimForGeneration so there
    // is no observable window in "ready".
    const correlationId = randomUUID();

    if (latestRun && latestRun.status === "completed") {
      // Claim failed → ready atomically; a concurrent retry cannot also claim.
      const { claimed: readyClaimed } = await this.strategyRepository.claimForGeneration(
        id,
        ["failed"],
        "ready",
      );
      if (!readyClaimed) {
        throw new BadRequestException("Retry is already in progress");
      }
      await this.strategyRepository.updateStrategyStatus(id, "queued");
      await this.strategyQueue.add(
        "generate-strategy",
        { strategyId: id, retrievalRunId: latestRun.id, correlationId },
        { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
      );
      await this.recordProgress(id, {
        stage: "queued",
        status: "started",
        messageKey: "strategy.retry.resumed",
        messageText: "Resuming generation from completed retrieval.",
        payload: { retrieval_run_id: latestRun.id, correlation_id: correlationId },
      });
      return { status: "queued", message: "Resuming from completed retrieval", correlationId };
    }

    // Retrieval also failed — restart from the beginning. The FSM only
    // allows failed → ready, so transition to ready first, then
    // startGeneration will atomically claim ready → retrieving.
    // Use claimForGeneration so a concurrent retry cannot also transition.
    const { claimed: restartClaimed } = await this.strategyRepository.claimForGeneration(
      id,
      ["failed"],
      "ready",
    );
    if (!restartClaimed) {
      throw new BadRequestException("Retry is already in progress");
    }
    return this.startGeneration(id, ownerUserId);
  }

  // ── Progress events ────────────────────────────────────────────────

  private async recordProgress(
    strategyId: string,
    event: Parameters<StrategyRepository["appendProgressEvent"]>[1],
  ): Promise<void> {
    try {
      await this.strategyRepository.appendProgressEvent(strategyId, event);
    } catch (error: unknown) {
      // Progress persistence must never break the lifecycle itself; log only.
      this.logger.warn(
        `[Strategy ${strategyId}] Failed to persist progress event: ${errorMessage(error)}`,
      );
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const e = error as { response?: { status?: number }; code?: string };
    return e.response?.status === 503 || e.code === "ECONNABORTED";
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}