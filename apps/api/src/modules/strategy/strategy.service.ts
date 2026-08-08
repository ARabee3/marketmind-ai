import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { randomUUID } from "crypto";
import type {
  OwnerDecision,
  StrategyProgressEvent,
  StrategyVersionSummary,
} from "@marketmind/contracts";
import { CHANNEL_SETUP_STATES } from "@marketmind/contracts";
import { StrategyRepository } from "./strategy.repository";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { UpsertBriefDto } from "./dto/upsert-brief.dto";
import { OwnerDecisionDto } from "./dto/owner-decision.dto";
import { StrategyProgressGateway } from "./strategy-progress.gateway";
import { strategyProgressEventsFromPersistence } from "./strategy-progress.mapper";
import { buildRetrievalQueryContext } from "./strategy-ai-contract";
import { DEFAULT_AI_REQUEST_TIMEOUT_MS } from "../../common/config/external-provider.config";
import { BillingEntitlementsService } from "../billing/billing-entitlements.service";
import { TargetsService } from "../publishing/targets/targets.service";

/** Owner-initiated retry limit (distinct from BullMQ queue-level job retries). */
const MAX_OWNER_RETRIES = 3;

/** Strategy statuses from which a new generation run may legally start. */
const GENERATION_IDLE: Array<"ready"> = ["ready"];

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private readonly aiUrl: string;
  private readonly aiRequestTimeoutMs: number;

  constructor(
    private readonly strategyRepository: StrategyRepository,
    @InjectQueue("strategy-generation") private readonly strategyQueue: Queue,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly progressGateway: StrategyProgressGateway,
    private readonly targetsService: TargetsService,
    @Optional() private readonly billingEntitlements?: BillingEntitlementsService,
  ) {
    this.aiUrl =
      this.config.get<string>("aiService.url") ?? "http://localhost:8000";
    this.aiRequestTimeoutMs =
      this.config.get<number>("aiService.requestTimeoutMs") ??
      DEFAULT_AI_REQUEST_TIMEOUT_MS;
  }

  // ── POST /api/v1/strategies ─────────────────────────────────────────

  async createStrategy(dto: CreateStrategyDto, ownerUserId: string) {
    const profile =
      await this.strategyRepository.getConfirmedProfileVersionByIdAndOwner(
        dto.businessProfileVersionId,
        ownerUserId,
      );
    if (!profile) {
      throw new BadRequestException(
        "No confirmed business profile found for this owner.",
      );
    }
    return this.strategyRepository.createStrategy(
      profile.businessId,
      ownerUserId,
    );
  }

  // ── PUT /api/v1/strategies/:id/brief ───────────────────────────────

  async upsertBrief(id: string, ownerUserId: string, dto: UpsertBriefDto) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy)
      throw new NotFoundException("Strategy not found or unauthorized");

    if (strategy.status !== "needs_brief" && strategy.status !== "ready") {
      throw new ConflictException(
        "The Strategy brief is locked after generation starts. Create a revision through an owner decision instead.",
      );
    }

    const profile =
      await this.strategyRepository.getConfirmedProfileVersionByIdAndOwner(
        dto.businessProfileVersionId,
        ownerUserId,
      );
    if (!profile || profile.businessId !== strategy.businessId) {
      throw new BadRequestException(
        "The confirmed business profile does not belong to this Strategy.",
      );
    }

    // Conditional validation: when paid media is allowed with a concrete
    // budget mode, the owner must supply an EGP amount or range.
    if (
      dto.paidMediaAllowed &&
      (dto.externalBudgetMode === "monthly_amount" ||
        dto.externalBudgetMode === "three_month_amount") &&
      dto.externalBudgetEgpAmount == null &&
      !dto.externalBudgetEgpRange
    ) {
      throw new BadRequestException(
        "externalBudgetEgpAmount or externalBudgetEgpRange is required when paidMediaAllowed is true and externalBudgetMode is monthly_amount or three_month_amount",
      );
    }

    // Normalize the DTO into the Prisma JSON shape for external_budget_egp.
    const externalBudgetEgp = normalizeExternalBudgetEgp(
      dto.externalBudgetEgpAmount,
      dto.externalBudgetEgpRange,
    );

    const isV2 = strategy.contractVersion === "strategy-v2";
    if (isV2) {
      assertValidChannelChoices(dto.channelChoices ?? []);
      await this.assertConnectedTargetBindings(
        dto.channelChoices ?? [],
        strategy.businessId,
      );
      if (!dto.weeklyCapacity) {
        throw new BadRequestException(
          "weeklyCapacity is required for an owner-first Strategy brief",
        );
      }
    } else if (!dto.teamCapacity) {
      throw new BadRequestException(
        "teamCapacity is required for this Strategy brief",
      );
    }

    // Persist only against the owner-confirmed profile verified above. The
    // status guard keeps the brief immutable once a generated version can
    // reference it for provenance.
    const brief = await this.strategyRepository.upsertBrief(id, {
      businessProfileVersionId: dto.businessProfileVersionId,
      primaryObjective: dto.primaryObjective,
      startDate: normalizeStartDate(dto.startDate),
      planLanguage: dto.planLanguage,
      paidMediaAllowed: dto.paidMediaAllowed,
      externalBudgetMode: dto.externalBudgetMode,
      externalBudgetEgp,
      teamCapacity: dto.teamCapacity,
      constraints: dto.constraints,
      clarificationAnswers: dto.clarificationAnswers ?? [],
      ...(isV2
        ? {
            weeklyCapacity: dto.weeklyCapacity,
            weeklyCapacityNote: dto.weeklyCapacityNote ?? null,
            channelChoices: toPersistedChannelChoices(dto.channelChoices ?? []),
          }
        : {}),
    } as never);

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

    return {
      ...brief,
      channelChoices: normalizeChannelChoicesForResponse(
        (brief as { channelChoices?: unknown }).channelChoices,
      ),
    };
  }

  /**
   * A Strategy brief carries only the public publishing-target id. Resolve it
   * inside the business scope and verify that it is still usable for the
   * selected channel before persisting the brief. This keeps stale, revoked,
   * cross-business, or capability-incompatible targets out of the content
   * handoff without exposing provider or credential details.
   */
  private async assertConnectedTargetBindings(
    choices: Array<{
      channel: string;
      setupState: string;
      publishingTargetId?: string;
    }>,
    businessId: string,
  ): Promise<void> {
    for (const choice of choices) {
      if (choice.setupState !== "connected") continue;

      if (!choice.publishingTargetId) {
        throw new BadRequestException({
          code: "STRATEGY_TARGET_REQUIRED",
          message: "A connected channel must have a publishing target.",
          recovery: "choose_target",
        });
      }

      let target: Awaited<ReturnType<TargetsService["getTarget"]>>;
      try {
        target = await this.targetsService.getTarget(
          choice.publishingTargetId,
          businessId,
        );
      } catch {
        throw strategyTargetUnavailable("choose_target");
      }

      const targetChannel = target.channel.trim().toLowerCase();
      if (targetChannel !== choice.channel.trim().toLowerCase()) {
        throw strategyTargetUnavailable("choose_target");
      }

      const state = target.connectionState.trim().toUpperCase();
      const expiryTime =
        target.expiresAt == null ? null : new Date(target.expiresAt).getTime();
      const expired =
        expiryTime != null && (!Number.isFinite(expiryTime) || expiryTime <= Date.now());
      if (state !== "CONNECTED" || expired) {
        throw strategyTargetUnavailable("reconnect");
      }

      const capabilities = Array.isArray(target.capabilities)
        ? target.capabilities.filter(
            (capability): capability is string =>
              typeof capability === "string",
          )
        : [];
      if (!capabilities.includes("static_image")) {
        throw strategyTargetUnavailable("choose_target");
      }
    }
  }

  private isBriefReady(brief: {
    primaryObjective: string;
    startDate: Date | string;
    planLanguage: string;
    externalBudgetMode: string;
    teamCapacity: string;
    weeklyCapacity: string | null;
    channelChoices: unknown;
  }): boolean {
    return !!(
      brief.primaryObjective &&
      brief.startDate &&
      brief.planLanguage &&
      brief.externalBudgetMode &&
      (brief.teamCapacity || (brief.weeklyCapacity && Array.isArray(brief.channelChoices) && brief.channelChoices.length > 0))
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

    await this.billingEntitlements?.assertAllowed(
      ownerUserId,
      "strategy_cycle",
      1,
    );

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
    const latestProfile =
      await this.strategyRepository.getActiveConfirmedProfileVersion(
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
      const brief = strategy.brief;
      const queryContext = buildRetrievalQueryContext(
        brief,
        latestProfile,
        strategy.business,
      );

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiUrl}/internal/v1/ai/strategy/retrieve`,
          queryContext,
          {
            params: {
              strategy_id: strategy.id,
              brief_id: brief.id,
              profile_version_id: brief.businessProfileVersionId,
            },
            timeout: this.aiRequestTimeoutMs,
          },
        ),
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

      // No BullMQ auto-retry: the strategy FSM only allows failed → ready, so
      // generation failures are retried by the owner via POST /:id/retry, never
      // by re-running this job (which would hit an illegal failed → generating
      // transition and crash-loop).
      await this.strategyRepository.updateStrategyStatus(id, "queued");
      await this.strategyQueue.add(
        "generate-strategy",
        { strategyId: id, retrievalRunId: retrieval_run_id, correlationId },
        { attempts: 1 },
      );
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

    const currentVersion = strategy.currentVersionId
      ? await this.strategyRepository.getVersionById(strategy.currentVersionId)
      : null;

    return {
      ...strategy,
      brief: strategy.brief
        ? {
            ...strategy.brief,
            channelChoices: normalizeChannelChoicesForResponse(
              (strategy.brief as { channelChoices?: unknown }).channelChoices,
            ),
          }
        : strategy.brief,
      latestPlan:
        currentVersion?.strategyId === id ? currentVersion.planData : null,
    };
  }

  // ── GET /api/v1/strategies/:id/versions ─────────────────────────────

  async getStrategyVersions(id: string, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    const versions = await this.strategyRepository.listVersions(id);
    const retrievalRunIds = versions
      .map((version) => version.retrievalRunId)
      .filter((runId): runId is string => runId !== null);
    const runBriefIds =
      await this.strategyRepository.listRetrievalRunBriefIds(retrievalRunIds);
    const briefIdByRunId = new Map(
      runBriefIds.map((run) => [run.id, run.briefId]),
    );
    return versions.map((version, index) =>
      toVersionSummary(
        version,
        version.retrievalRunId
          ? briefIdByRunId.get(version.retrievalRunId)
          : null,
        index === 0 ? strategy.status : null,
      ),
    );
  }

  // ── GET /api/v1/strategies/:id/versions/:version ───────────────────

  async getStrategyVersion(id: string, version: number, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    const v = await this.strategyRepository.getVersionByNumber(id, version);
    if (!v)
      throw new NotFoundException(`Strategy version ${version} not found`);
    return v.planData;
  }

  // ── GET /api/v1/strategies/:id/retrieval ───────────────────────────

  async getRetrievalPack(id: string, ownerUserId: string) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    const run = await this.strategyRepository.getLatestRetrievalRun(id);
    if (!run)
      throw new NotFoundException("No retrieval pack found for this strategy");
    return toRetrievalPack(run);
  }

  async getProgressEvents(
    id: string,
    ownerUserId: string,
  ): Promise<StrategyProgressEvent[]> {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    const events = await this.strategyRepository.listProgressEvents(id);
    return strategyProgressEventsFromPersistence(events);
  }

  // ── POST /api/v1/strategies/:id/decisions ──────────────────────────

  async handleDecision(id: string, ownerUserId: string, dto: OwnerDecisionDto) {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!strategy) throw new NotFoundException("Strategy not found");

    if (strategy.status !== "draft") {
      throw new BadRequestException(
        "Decisions can only be made on a draft strategy",
      );
    }

    if (
      !strategy.currentVersionId ||
      strategy.currentVersionId !== dto.versionId
    ) {
      throw new ConflictException({
        code: "STRATEGY_VERSION_CONFLICT",
        message:
          "This draft is no longer the current Strategy version. Refresh before deciding.",
        currentVersionId: strategy.currentVersionId,
      });
    }

    const targetVersion = await this.strategyRepository.getVersionById(
      dto.versionId,
    );
    if (!targetVersion || targetVersion.strategyId !== id) {
      throw new NotFoundException("Strategy version not found");
    }

    if (
      (dto.action === "reject" || dto.action === "revision_requested") &&
      !dto.feedback?.trim()
    ) {
      throw new BadRequestException(
        "Owner feedback is required when rejecting or requesting a revision",
      );
    }

    if (dto.action === "approve") {
      await this.assertApprovalReady(strategy, targetVersion);
    }

    // Atomic idempotency: claim via the terminal transition so a concurrent
    // duplicate approve/reject cannot both succeed.
    if (dto.action === "revision_requested") {
      await this.billingEntitlements?.assertAllowed(
        ownerUserId,
        "strategy_revision",
        1,
      );
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
      // No BullMQ auto-retry — the owner retries a failed revision via
      // POST /:id/retry (failed → ready), never by re-running this job.
      await this.strategyQueue.add(
        "revise-strategy",
        {
          strategyId: id,
          priorVersionId: dto.versionId,
          feedback: dto.feedback,
          correlationId,
        },
        { attempts: 1 },
      );

      this.logger.log(
        `[Strategy ${id}] [Corr: ${correlationId}] Revision requested. Prior version: ${dto.versionId}`,
      );

      return { decision, correlationId };
    }

    // approve / reject — recordOwnerDecision enforces FSM + transitions atomically.
    const { decision, nextStatus } =
      await this.strategyRepository.recordOwnerDecision(
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
          nextStatus === "approved" ? "strategy.approved" : "strategy.rejected",
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

    const latestProgress =
      await this.strategyRepository.getLatestProgressEvent(id);
    const latestPayload = toPayload(latestProgress?.payload);
    if (
      !latestProgress ||
      latestProgress.status !== "failed" ||
      latestPayload.retryable !== true
    ) {
      throw new BadRequestException({
        code: "STRATEGY_RETRY_NOT_ALLOWED",
        message: "The latest Strategy failure is not retryable.",
      });
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
    const latestProfile =
      await this.strategyRepository.getActiveConfirmedProfileVersion(
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
      await this.strategyRepository.recordRetryDecision(
        latestVersion.id,
        ownerUserId,
      );
    }

    const latestRun = await this.strategyRepository.getLatestRetrievalRun(id);

    const correlationId = randomUUID();

    if (latestRun && latestRun.status === "completed") {
      const { claimed: readyClaimed } =
        await this.strategyRepository.claimForGeneration(
          id,
          ["failed"],
          "ready",
        );
      if (!readyClaimed) {
        throw new BadRequestException("Retry is already in progress");
      }
      const { claimed: retrievingClaimed } =
        await this.strategyRepository.claimForGeneration(
          id,
          ["ready"],
          "retrieving",
        );
      if (!retrievingClaimed) {
        throw new BadRequestException("Retry is already in progress");
      }
      await this.strategyRepository.updateStrategyStatus(id, "queued");
      // No BullMQ auto-retry — retries go through the FSM-approved owner path.
      await this.strategyQueue.add(
        "generate-strategy",
        { strategyId: id, retrievalRunId: latestRun.id, correlationId },
        { attempts: 1 },
      );
      await this.recordProgress(id, {
        stage: "queued",
        status: "started",
        messageKey: "strategy.retry.resumed",
        messageText: "Resuming generation from completed retrieval.",
        payload: {
          retrieval_run_id: latestRun.id,
          correlation_id: correlationId,
        },
      });
      return {
        status: "queued",
        message: "Resuming from completed retrieval",
        correlationId,
      };
    }

    // Retrieval also failed — restart from the beginning. The FSM only
    // allows failed → ready, so transition to ready first, then
    // startGeneration will atomically claim ready → retrieving.
    // Use claimForGeneration so a concurrent retry cannot also transition.
    const { claimed: restartClaimed } =
      await this.strategyRepository.claimForGeneration(id, ["failed"], "ready");
    if (!restartClaimed) {
      throw new BadRequestException("Retry is already in progress");
    }
    return this.startGeneration(id, ownerUserId);
  }

  private async assertApprovalReady(
    strategy: NonNullable<
      Awaited<ReturnType<StrategyRepository["getStrategyByIdAndOwner"]>>
    >,
    version: NonNullable<
      Awaited<ReturnType<StrategyRepository["getVersionById"]>>
    >,
  ): Promise<void> {
    const latestProfile =
      await this.strategyRepository.getActiveConfirmedProfileVersion(
        strategy.businessId,
      );
    if (
      !strategy.brief ||
      !latestProfile ||
      latestProfile.id !== strategy.brief.businessProfileVersionId
    ) {
      throw new ConflictException({
        code: "STRATEGY_PROFILE_STALE",
        message:
          "The confirmed Business Profile changed after this Strategy Brief was saved.",
      });
    }

    const plan = toPayload(version.planData);
    const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
    const hasBlockingItem = blockers.some(
      (blocker) =>
        blocker &&
        typeof blocker === "object" &&
        (blocker as { severity?: unknown }).severity === "blocking",
    );
    if (hasBlockingItem) {
      throw new BadRequestException({
        code: "STRATEGY_APPROVAL_BLOCKED",
        message: "Resolve every blocking Strategy item before approval.",
      });
    }

    const run = await this.strategyRepository.getLatestRetrievalRun(
      strategy.id,
    );
    if (
      !run ||
      run.id !== version.retrievalRunId ||
      run.status !== "completed"
    ) {
      throw new BadRequestException({
        code: "STRATEGY_RETRIEVAL_FAILURE",
        message: "The persisted retrieval pack for this draft is unavailable.",
      });
    }

    const now = Date.now();
    const eligibleItems = new Map(
      run.items
        .filter(
          (item) =>
            item.reviewStatus === "approved" &&
            item.effectiveAt.getTime() <= now &&
            (item.expiresAt === null || item.expiresAt.getTime() > now),
        )
        .map((item) => [item.chunkId, item]),
    );
    const citations = Array.isArray(plan.citations) ? plan.citations : [];
    const everyCitationResolves =
      citations.length > 0 &&
      citations.every(
        (citation) =>
          citation &&
          typeof citation === "object" &&
          typeof (citation as { chunk_id?: unknown }).chunk_id === "string" &&
          typeof (citation as { entry_id?: unknown }).entry_id === "string" &&
          typeof (citation as { entry_version?: unknown }).entry_version ===
            "number" &&
          (() => {
            const typedCitation = citation as {
              chunk_id: string;
              entry_id: string;
              entry_version: number;
            };
            const item = eligibleItems.get(typedCitation.chunk_id);
            return Boolean(
              item &&
              item.entryId === typedCitation.entry_id &&
              item.entryVersion === typedCitation.entry_version,
            );
          })(),
      );

    if (!everyCitationResolves) {
      throw new BadRequestException({
        code: "STRATEGY_INVALID_CITATION",
        message:
          "Every Strategy citation must resolve to approved, current knowledge in its persisted retrieval pack.",
      });
    }
  }

  // ── Progress events ────────────────────────────────────────────────

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

function toPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    payload[key] = item;
  }
  return payload;
}

/**
 * Normalizes the two DTO input shapes (single amount or min/max range) into
 * the Prisma JSON column. Returns null for organic-only budgets.
 *
 * - number → stored as-is (single amount)
 * - { min_egp, max_egp } → stored as-is (range)
 * - neither provided → null
 */
function normalizeExternalBudgetEgp(
  amount?: number,
  range?: { min_egp?: number; max_egp?: number },
): number | { min_egp: number; max_egp: number } | null {
  if (amount != null) return amount;
  if (range && (range.min_egp != null || range.max_egp != null)) {
    return {
      min_egp: range.min_egp ?? 0,
      max_egp: range.max_egp ?? 0,
    };
  }
  return null;
}

/**
 * Normalizes the DTO startDate (an ISO-8601 date string that may be
 * date-only, e.g. "2026-08-01") into a `Date` Prisma can persist. Prisma's
 * DateTime scalar rejects date-only strings, so a bare YYYY-MM-DD would
 * otherwise surface as a raw PrismaClientValidationError.
 */
function normalizeStartDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(
      `startDate is not a valid ISO-8601 date: ${value}`,
    );
  }
  return date;
}

/**
 * Prisma stores the AI-facing channel-choice JSON in snake_case. HTTP clients
 * consume the owner-facing camelCase brief, so normalize only these public
 * fields at the response boundary while leaving the persisted/AI contract
 * unchanged.
 */
function normalizeChannelChoicesForResponse(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const raw = entry as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...raw };
    if (normalized.setupState == null && typeof raw.setup_state === "string") {
      normalized.setupState = raw.setup_state;
    }
    if (normalized.publicUrl == null && typeof raw.public_url === "string") {
      normalized.publicUrl = raw.public_url;
    }
    if (
      normalized.publishingTargetId == null &&
      typeof raw.publishing_target_id === "string"
    ) {
      normalized.publishingTargetId = raw.publishing_target_id;
    }
    delete normalized.setup_state;
    delete normalized.public_url;
    delete normalized.publishing_target_id;
    return normalized;
  });
}

/**
 * Owner-first channel-choice invariants (issue #135): 1–3 unique catalog
 * channels, exactly one primary, at most two supporting, and a safe setup
 * state. A public URL is only allowed for an owner-managed existing link and
 * a publishing target only for a connected channel — the brief never carries
 * credentials or provider secrets.
 */
function assertValidChannelChoices(
  choices: Array<{
    channel: string;
    role: string;
    setupState: string;
    publicUrl?: string;
    publishingTargetId?: string;
  }>,
): void {
  if (choices.length < 1 || choices.length > 3) {
    throw new BadRequestException(
      "An owner-first Strategy brief must contain 1 to 3 channel choices.",
    );
  }
  const channels = choices.map((choice) => choice.channel);
  if (new Set(channels).size !== channels.length) {
    throw new BadRequestException(
      "Channel choices must be unique.",
    );
  }
  const primaryCount = choices.filter(
    (choice) => choice.role === "primary",
  ).length;
  if (primaryCount !== 1) {
    throw new BadRequestException(
      "Exactly one primary channel must be selected.",
    );
  }
  const supportingCount = choices.filter(
    (choice) => choice.role === "supporting",
  ).length;
  if (supportingCount > 2) {
    throw new BadRequestException(
      "At most two supporting channels may be selected.",
    );
  }
  choices.forEach((choice, index) => {
    if (!CHANNEL_SETUP_STATES.includes(choice.setupState as never)) {
      throw new BadRequestException(
        `Unsupported setup state '${choice.setupState}' for channel ${index + 1}.`,
      );
    }
    if (choice.setupState !== "existing_link" && choice.publicUrl) {
      throw new BadRequestException(
        "A public URL is only allowed for an existing_link setup state.",
      );
    }
    if (choice.setupState === "existing_link" && !choice.publicUrl?.trim()) {
      throw new BadRequestException(
        "An existing_link choice requires an owner-managed public URL.",
      );
    }
    if (choice.setupState !== "connected" && choice.publishingTargetId) {
      throw new BadRequestException(
        "A publishing target is only allowed for a connected setup state.",
      );
    }
    if (choice.setupState === "connected" && !choice.publishingTargetId) {
      throw new BadRequestException(
        "A connected setup state requires a publishing target.",
      );
    }
  });
}

function strategyTargetUnavailable(
  recovery: "reconnect" | "choose_target" | "setup_later",
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: "STRATEGY_TARGET_UNAVAILABLE",
    message: "The selected publishing target is not available for this channel.",
    recovery,
  });
}

/**
 * Persists channel choices in the wire-contract snake_case shape so the AI
 * payload builder (`buildContractBrief`) can pass them through unchanged.
 * Only the safe fields are stored — never credentials or provider secrets.
 */
function toPersistedChannelChoices(
  choices: Array<{
    channel: string;
    role: string;
    setupState: string;
    publicUrl?: string;
    publishingTargetId?: string;
    note?: string;
  }>,
): Array<Record<string, unknown>> {
  return choices.map((choice) => {
    const persisted: Record<string, unknown> = {
      channel: choice.channel,
      role: choice.role,
      setup_state: choice.setupState,
    };
    if (choice.publicUrl) persisted.public_url = choice.publicUrl;
    if (choice.publishingTargetId) {
      persisted.publishing_target_id = choice.publishingTargetId;
    }
    if (choice.note) persisted.note = choice.note;
    return persisted;
  });
}

function toVersionSummary(
  v: Awaited<ReturnType<StrategyRepository["listVersions"]>>[number],
  briefId: string | null | undefined,
  currentStrategyStatus: string | null,
): StrategyVersionSummary {
  const persistedDecision = v.decisions
    ?.filter(
      (item) =>
        item.action === "approve" ||
        item.action === "reject" ||
        item.action === "revision_requested",
    )
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )[0];
  const normalizedDecision = persistedDecision
    ? normalizeOwnerDecision(persistedDecision.action)
    : null;
  const decision =
    persistedDecision && normalizedDecision
      ? {
          id: persistedDecision.id,
          strategy_id: v.strategyId,
          strategy_version: v.version,
          decision: normalizedDecision,
          revision_notes: persistedDecision.feedback,
          decided_by_user_id: persistedDecision.ownerUserId,
          decided_at: persistedDecision.createdAt.toISOString(),
        }
      : undefined;
  const plan = toPayload(v.planData);
  const profileVersion = toPayload(plan.profile_version);
  const profileVersionId = profileVersion.business_profile_version_id;
  const profileConfirmedAt = profileVersion.confirmed_at;
  const profileVersionNumber = profileVersion.version;
  if (
    !briefId ||
    !v.retrievalRunId ||
    typeof profileVersionId !== "string" ||
    typeof profileConfirmedAt !== "string" ||
    typeof profileVersionNumber !== "number"
  ) {
    throw new InternalServerErrorException(
      `Strategy version ${v.id} has incomplete provenance metadata.`,
    );
  }
  const status =
    decision?.decision === "approved"
      ? "approved"
      : decision?.decision === "rejected"
        ? "rejected"
        : currentStrategyStatus === "approved"
          ? "approved"
          : currentStrategyStatus === "rejected"
            ? "rejected"
            : "draft";

  return {
    version_id: v.id,
    strategy_id: v.strategyId,
    version: v.version,
    status,
    brief_id: briefId,
    retrieval_run_id: v.retrievalRunId,
    profile_version: {
      business_profile_version_id: profileVersionId,
      confirmed_at: profileConfirmedAt,
      version: profileVersionNumber,
    },
    prompt_config: sanitizePromptConfig(v.promptConfig),
    created_at: v.createdAt.toISOString(),
    decision,
  };
}

function sanitizePromptConfig(
  value: unknown,
): Record<string, string | number | boolean | null> {
  const config = toPayload(value);
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(config)) {
    if (
      /token|secret|password|credential|api.?key|authorization|private.?key|bearer/i.test(
        key,
      )
    ) {
      continue;
    }
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      safe[key] = item as string | number | boolean | null;
    }
  }
  return safe;
}

function normalizeOwnerDecision(
  action: string,
): OwnerDecision["decision"] | null {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  if (action === "revision_requested") return "revision_requested";
  return null;
}

function toRetrievalPack(
  run: NonNullable<
    Awaited<ReturnType<StrategyRepository["getLatestRetrievalRun"]>>
  >,
) {
  return {
    retrieval_run_id: run.id,
    strategy_id: run.strategyId,
    brief_id: run.briefId,
    profile_version_id: run.profileVersionId,
    query_summary: run.querySummary,
    query_context: toPayload(run.queryContext),
    items: run.items.map((item) => ({
      chunk_id: item.chunkId,
      entry_id: item.entryId,
      entry_version: item.entryVersion,
      title: item.title,
      excerpt: item.excerpt,
      kind: item.kind,
      tags: toStringArrayRecord(item.tags),
      relevance_score: item.relevanceScore,
      source_quality: {
        evidence_tier: item.evidenceTier,
        source_references: item.sourceReferences,
        effective_at: item.effectiveAt.toISOString(),
        expires_at: item.expiresAt?.toISOString() ?? null,
        review_status: item.reviewStatus,
      },
      market_tier: item.marketTier,
      is_fallback: item.isFallback,
      fallback_label: item.fallbackLabel,
    })),
    knowledge_gaps: run.gaps.map((gap) => ({
      category: gap.category,
      description: gap.description,
      severity: gap.severity,
    })),
    retrieval_metadata: {
      ...toPayload(run.configuration),
      retrieval_latency_ms: run.latencyMs,
    },
    retrieved_at: (run.finishedAt ?? run.createdAt).toISOString(),
  };
}

function toStringArrayRecord(value: unknown): Record<string, string[]> {
  const input = toPayload(value);
  const result: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(input)) {
    if (
      Array.isArray(item) &&
      item.every((entry) => typeof entry === "string")
    ) {
      result[key] = item;
    }
  }
  return result;
}
