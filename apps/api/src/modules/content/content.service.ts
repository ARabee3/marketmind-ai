import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  CONTENT_CHANNELS,
  canonicalPublishingJson,
  validateContentPolicyFixture,
  validatePublicationCandidateHandoff,
} from "@marketmind/contracts";
import type {
  CairoTimezone,
  ContentAsset,
  ContentCtaDestination,
  ContentChannel,
  ContentCycle,
  ContentCycleResponse,
  ContentCycleStatus,
  ContentDecision,
  ContentDecisionRequest,
  ContentDecisionResponse,
  ContentErrorCode,
  ContentItemVersion,
  ContentPack,
  ContentPolicyFixture,
  ContentProgressEvent,
  ContentPromotion,
  ContentWeekContext,
  ContentWeekListResponse,
  CreateContentCycleRequest,
  GenerateContentPackRequest,
  PublicationCandidateStatusV1,
  PublicationCandidateV1,
  StrategyPlan,
  UpsertContentWeekContextRequest,
} from "@marketmind/contracts";
import type {
  ContentAsset as PrismaContentAsset,
  ContentItemVersion as PrismaContentItemVersion,
  ContentWeekContext as PrismaWeekContext,
} from "@prisma/client";
import type { ContentPack as PrismaContentPack } from "@prisma/client";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import type { PersistedContentProgressEvent } from "./repositories/content-pack.repository";
import { ContentDecisionRepository } from "./repositories/content-decision.repository";
import type {
  BulkContentDecisionRequest,
  ContentDecisionRow,
} from "./repositories/content-decision.repository";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";
import type {
  CreateCandidateInput,
  PublicationCandidateAssetInput,
} from "./repositories/publication-candidate.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  AssetStorage,
  CONTENT_ASSET_STORAGE,
} from "./assets/asset-storage.port";
import {
  cairoCalendarDate,
  weekCutoffDate,
  weekStartDate,
} from "./content-schedule";

export type BulkDecisionItemStatus =
  | "approved"
  | "rejected"
  | "revision_requested"
  | "ineligible";

export type BulkDecisionItemResult = {
  readonly item_id: string;
  readonly status: BulkDecisionItemStatus;
  readonly error?: { readonly code: string; readonly message: string };
};

type DecisionFixtureCache = {
  readonly strategy: Awaited<
    ReturnType<StrategyRepository["getStrategyByIdAndOwner"]>
  >;
  readonly strategyDecision: Awaited<
    ReturnType<StrategyRepository["getDecisionById"]>
  >;
  readonly strategyVersion: Awaited<
    ReturnType<StrategyRepository["getVersionByNumber"]>
  >;
  readonly currentProfile: Awaited<
    ReturnType<StrategyRepository["getActiveConfirmedProfileVersion"]>
  >;
  readonly cycle: Awaited<
    ReturnType<ContentCycleRepository["getCycleByIdAndOwner"]>
  >;
  readonly weeks: Awaited<
    ReturnType<ContentWeekContextRepository["listWeeks"]>
  >;
};

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly cycleRepository: ContentCycleRepository,
    private readonly weekContextRepository: ContentWeekContextRepository,
    private readonly strategyRepository: StrategyRepository,
    private readonly packRepository: ContentPackRepository,
    private readonly decisionRepository: ContentDecisionRepository,
    private readonly candidateRepository: PublicationCandidateRepository,
    private readonly prisma: PrismaService,
    @Inject(CONTENT_ASSET_STORAGE) private readonly assetStorage: AssetStorage,
    @InjectQueue("content-generation") private readonly contentQueue: Queue,
    @InjectQueue("content-outbox") private readonly outboxQueue: Queue,
  ) {}

  // ── POST /api/v1/content-cycles ────────────────────────────────────

  /**
   * Starts the rolling 12-week Content cycle from an owner-approved Strategy.
   *
   * Every precondition is re-checked server-side against persisted state — a
   * client-supplied `approved: true` is never trusted (arch doc 736-737):
   * 1. the referenced Strategy exists and belongs to the owner;
   * 2. the Strategy is `approved`;
   * 3. `strategy_version` matches the current approved version;
   * 4. the approved BusinessProfileVersion is still the active confirmed
   *    profile (`CONTENT_PROFILE_STALE` otherwise — arch doc 175-191);
   * 5. week 1 starts on the Strategy brief's start date and the week-1
   *    generation cutoff is the end of the current Strategy week.
   *
   * The cycle row itself is created idempotently on `idempotency_key`, then the
   * initial owner-confirmed week context is persisted for week 1.
   */
  async createCycle(
    dto: CreateContentCycleRequest,
    ownerUserId: string,
  ): Promise<ContentCycleResponse> {
    const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
      dto.strategy_id,
      ownerUserId,
    );
    if (!strategy) {
      throw new NotFoundException("Strategy not found");
    }

    if (strategy.status !== "approved") {
      throw new BadRequestException({
        code: "CONTENT_STRATEGY_NOT_APPROVED",
        message:
          "Content can only start from an approved Strategy. Approve the Strategy before starting Content.",
      });
    }

    if (!strategy.currentVersionId) {
      throw new BadRequestException({
        code: "CONTENT_STRATEGY_NOT_APPROVED",
        message: "The approved Strategy has no current version.",
      });
    }

    const currentVersion = await this.strategyRepository.getVersionById(
      strategy.currentVersionId,
    );
    if (
      !currentVersion ||
      currentVersion.strategyId !== strategy.id ||
      currentVersion.version !== dto.strategy_version
    ) {
      throw new ConflictException({
        code: "CONTENT_STRATEGY_NOT_APPROVED",
        message: `Strategy version ${dto.strategy_version} is not the current approved version. Refresh before starting Content.`,
      });
    }

    // The approved BusinessProfileVersion must still be the active confirmed
    // profile. The profile_version_id is taken from the Strategy's brief, so
    // the brief must exist and match the latest confirmed profile.
    const briefProfileId = strategy.brief?.businessProfileVersionId;
    const latestProfile =
      await this.strategyRepository.getActiveConfirmedProfileVersion(
        strategy.businessId,
      );
    if (
      !briefProfileId ||
      !latestProfile ||
      latestProfile.id !== briefProfileId
    ) {
      throw new ConflictException({
        code: "CONTENT_PROFILE_STALE",
        message:
          "The confirmed Business Profile changed after the approved Strategy was saved. Refresh the profile before starting Content.",
      });
    }

    const strategyDecision = await this.strategyRepository.getDecisionById(
      dto.strategy_decision_id,
    );
    if (
      !strategyDecision ||
      strategyDecision.strategyVersionId !== currentVersion.id ||
      strategyDecision.ownerUserId !== ownerUserId ||
      strategyDecision.action !== "approve"
    ) {
      throw new ConflictException({
        code: "CONTENT_STRATEGY_NOT_APPROVED",
        message:
          "The supplied strategy_decision_id does not match the approved Strategy version for this owner.",
      });
    }

    // Week 1 starts on the Strategy brief's start date. The generation cutoff
    // for week 1 is the end of the current Strategy week (start of week 2),
    // so the next draft is available before the next week begins (arch doc
    // 482-489). The exact clock time is configuration, not an LLM decision.
    const week1StartIso = cairoCalendarDate(strategy.brief.startDate);
    const week1StartDate = new Date(`${week1StartIso}T00:00:00.000Z`);
    const nextGenerationAt = weekCutoffDate(week1StartDate, 1);
    const requestFingerprint = createHash("sha256")
      .update(
        canonicalPublishingJson({
          ownerUserId,
          businessId: strategy.businessId,
          strategyId: strategy.id,
          strategyVersion: currentVersion.version,
          strategyDecisionId: dto.strategy_decision_id,
          profileVersionId: briefProfileId,
          initialWeekContext: dto.initial_week_context,
        }),
        "utf8",
      )
      .digest("hex");

    const created = await this.cycleRepository.createCycleWithWeekOne(
      {
        businessId: strategy.businessId,
        strategyId: strategy.id,
        strategyVersion: currentVersion.version,
        strategyDecisionId: dto.strategy_decision_id,
        profileVersionId: briefProfileId,
        week1StartDate,
        idempotencyKey: dto.idempotency_key,
        requestFingerprint,
        nextGenerationAt,
        initialWeekContext: {
          ...dto.initial_week_context,
          week_number: 1,
          week_start_date: weekStartDate(week1StartDate, 1),
        },
      },
      ownerUserId,
    );

    this.logger.log(
      `[ContentCycle ${created.cycle.id}] ${created.created ? "Created" : "Replayed"} from approved Strategy ${strategy.id} v${currentVersion.version} for week 1 (cutoff ${nextGenerationAt.toISOString()}).`,
    );

    // Issue #110 requires week 1 to be queued immediately when the cycle starts.
    // generateWeek's idempotent claim ensures a duplicate cycle-creation request
    // never enqueues two jobs.
    await this.generateWeek(
      created.cycle.id,
      1,
      {
        content_cycle_id: created.cycle.id,
        week_number: 1,
        idempotency_key: `cycle-creation:${created.cycle.id}:week:1`,
      },
      ownerUserId,
    );

    return {
      content_cycle: toContentCycle(created.cycle),
      initial_week_context: toContentWeekContext(created.weekContext),
    };
  }

  // ── PUT /api/v1/content-cycles/:id/weeks/:week_number/context ──────

  /**
   * Confirms or updates the owner's context for one week of the cycle.
   *
   * Every precondition is re-checked server-side against persisted state, so
   * the client cannot renumber, backdate, or claim a week it does not own:
   * 1. the cycle exists and belongs to the owner (404);
   * 2. the cycle is active (CONTENT_CYCLE_PAUSED / CONTENT_CYCLE_COMPLETED);
   * 3. the week is within 1-12 (CONTENT_WEEK_OUT_OF_RANGE);
   * 4. the week is not yet claimed: its generation cutoff has not passed and
   *    the scheduler has not already persisted a system safe-default for it
   *    (CONTENT_WEEK_ALREADY_CLAIMED — arch doc 193-244).
   *
   * Week number and start date are always server-authoritative, derived from
   * the cycle's generation schedule; client-sent values are ignored. The owner
   * may keep refining a week's context until the week is claimed.
   */
  async upsertWeekContext(
    cycleId: string,
    weekNumber: number,
    dto: UpsertContentWeekContextRequest,
    ownerUserId: string,
  ): Promise<ContentWeekContext> {
    const cycle = await this.cycleRepository.getCycleByIdAndOwner(
      cycleId,
      ownerUserId,
    );
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }
    this.assertCycleActive(cycle);
    this.assertWeekNumberInRange(weekNumber);

    const week1StartDate = cycle.week1StartDate;

    // The week's generation cutoff is the start of the following week. Once it
    // has passed, the scheduler owns the week (arch doc 193-244).
    const cutoff = weekCutoffDate(week1StartDate, weekNumber);
    if (new Date() >= cutoff) {
      throw new ConflictException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Week ${weekNumber} has already passed its generation cutoff.`,
      });
    }

    // A persisted system safe-default claims the week for the scheduler; the
    // owner cannot override it.
    const weeks = await this.weekContextRepository.listWeeks(cycleId);
    const existing = weeks.find((week) => week.weekNumber === weekNumber);
    if (
      existing &&
      (existing.contextSource === "system_defaulted" || existing.frozenAt)
    ) {
      throw new ConflictException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Week ${weekNumber} was already claimed by the system safe default.`,
      });
    }

    // Once a pack has been claimed for this week, the context is frozen —
    // generation and approval must observe the same context bytes.
    const packExists = await this.packRepository.hasPackForWeek(
      cycleId,
      weekNumber,
    );
    if (packExists) {
      throw new ConflictException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Week ${weekNumber} context is frozen; a content pack has already been generated.`,
      });
    }

    const persisted = await this.weekContextRepository.upsertOwnerContext(
      cycleId,
      {
        ...dto,
        week_number: weekNumber,
        week_start_date: weekStartDate(week1StartDate, weekNumber),
      },
      ownerUserId,
    );

    this.logger.log(
      `[ContentCycle ${cycleId}] Owner-confirmed context for week ${weekNumber} (cutoff ${cutoff.toISOString()}).`,
    );

    return toContentWeekContext(persisted);
  }

  // ── Scheduler/processor safe default (no HTTP caller) ──────────────

  /**
   * Persists the system safe default for a week whose optional owner context
   * was never confirmed before its generation cutoff (arch doc 193-244).
   * Server/worker path: uses the owner-unscoped cycle read on purpose and is
   * never exposed through an HTTP handler.
   *
   * The safe default is promotion-free (mode `none`, no promotion object), has
   * no must-include/must-avoid instructions, inherits only approved reusable
   * assets, and takes its CTA from already-confirmed business data. An
   * expiring offer or unconfirmed operational fact is never carried into the
   * next week automatically (arch doc 243-244). The repository's atomic weekly
   * claim makes concurrent scheduler + manual generation resolve to the same
   * week context.
   */
  async safeDefaultWeekContext(
    cycleId: string,
    weekNumber: number,
  ): Promise<ContentWeekContext> {
    const cycle = await this.cycleRepository.getCycleById(cycleId);
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }
    this.assertWeekNumberInRange(weekNumber);

    const hasPack = await this.packRepository.hasPackForWeek(
      cycleId,
      weekNumber,
    );
    if (
      !hasPack &&
      !(
        (weekNumber === 1 && cycle.currentWeekNumber === 1) ||
        weekNumber === cycle.currentWeekNumber + 1
      )
    ) {
      throw new ConflictException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Week ${weekNumber} is not eligible for a safe-default claim.`,
      });
    }

    const persisted = await this.weekContextRepository.createSafeDefaultContext(
      cycleId,
      weekNumber,
      {
        weekStartDate: new Date(
          `${weekStartDate(cycle.week1StartDate, weekNumber)}T00:00:00.000Z`,
        ),
        cutoffAt: weekCutoffDate(cycle.week1StartDate, weekNumber),
      },
    );

    this.logger.log(
      `[ContentCycle ${cycleId}] Persisted system safe default for week ${weekNumber}.`,
    );

    return toContentWeekContext(persisted);
  }

  // ── POST /api/v1/content-cycles/:id/weeks/:week_number/generate ─────

  /**
   * Claims one (cycle, week) for generation and enqueues the AI job.
   *
   * The request path never calls the AI provider; it only persists the claim
   * and queues the work (queue + worker only). The claim is atomic: the pack
   * row insert is guarded by `@@unique([content_cycle_id, week_number])`, so a
   * scheduler and a manual request share one claim — the first insert wins and
   * a concurrent one resolves to the same pack (arch doc 731-734, 932-933).
   *
   * Preconditions (all re-checked server-side): the cycle exists and belongs
   * to the owner, is active, and the week is within 1-12. The week context is
   * resolved from the confirmed/safe-default rows; an absent context becomes
   * the explicit safe default (arch doc 930) so the pack always references a
   * valid week context. On an idempotent replay the existing pack is returned
   * without enqueuing a duplicate job.
   */
  async generateWeek(
    cycleId: string,
    weekNumber: number,
    dto: GenerateContentPackRequest,
    ownerUserId: string,
  ): Promise<{
    content_pack: ContentPack;
    status: "queued";
    correlation_id: string;
  }> {
    const cycle = await this.cycleRepository.getCycleByIdAndOwner(
      cycleId,
      ownerUserId,
    );
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }
    this.assertCycleActive(cycle);
    this.assertWeekNumberInRange(weekNumber);

    const existingPack = await this.packRepository.hasPackForWeek(
      cycleId,
      weekNumber,
    );
    if (
      !existingPack &&
      !(
        (weekNumber === 1 && cycle.currentWeekNumber === 1) ||
        weekNumber === cycle.currentWeekNumber + 1
      )
    ) {
      throw new ConflictException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Week ${weekNumber} is not the exact next eligible Content week.`,
      });
    }

    // Resolve the week context; an absent one becomes the explicit safe
    // default so the pack row always has a valid week_context_id.
    const weeks = await this.weekContextRepository.listWeeks(cycleId);
    const existingWeek = weeks.find((w) => w.weekNumber === weekNumber);
    const weekContextId =
      existingWeek?.id ??
      (await this.safeDefaultWeekContext(cycleId, weekNumber)).id;

    const { pack, created } = await this.packRepository.claimQueuedPack(
      cycleId,
      weekNumber,
      weekContextId,
    );

    const correlationId = randomUUID();
    if (!created) {
      // Idempotent replay. If the pack is still queued (no worker picked it up
      // because a previous queue.add failed after the claim), re-enqueue to
      // close the DB→Redis orphan window.
      if (
        pack.status === "queued" &&
        (!Array.isArray(pack.itemIds) || pack.itemIds.length === 0)
      ) {
        await this.contentQueue.add(
          "generate-content",
          {
            contentCycleId: cycleId,
            weekNumber,
            contentPackId: pack.id,
            idempotencyKey: dto.idempotency_key,
            correlationId: `pack:${pack.id}`,
          },
          { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
        );
      }
      return {
        content_pack: toContentPack(pack),
        status: "queued",
        correlation_id: `pack:${pack.id}`,
      };
    }

    await this.contentQueue.add(
      "generate-content",
      {
        contentCycleId: cycleId,
        weekNumber,
        contentPackId: pack.id,
        idempotencyKey: dto.idempotency_key,
        correlationId,
      },
      { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    await this.packRepository.appendProgressEvent(pack.id, {
      stage: "queued",
      status: "started",
      messageKey: "content.queued",
      messageText: "Generation job queued.",
      payload: { correlation_id: correlationId },
    });

    this.logger.log(
      `[ContentPack ${pack.id}] [Corr: ${correlationId}] Generation queued for week ${weekNumber}.`,
    );

    return {
      content_pack: toContentPack(pack),
      status: "queued",
      correlation_id: correlationId,
    };
  }

  // ── POST /api/v1/content-cycles/:id/pause + /resume ─────────────────

  async pauseCycle(
    id: string,
    ownerUserId: string,
    reason: string | null,
  ): Promise<ContentCycle> {
    const cycle = await this.cycleRepository.getCycleByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!cycle) throw new NotFoundException("Content cycle not found");
    const paused = await this.cycleRepository.pauseCycle(
      id,
      ownerUserId,
      reason ?? "",
    );
    return toContentCycle(paused);
  }

  async resumeCycle(id: string, ownerUserId: string): Promise<ContentCycle> {
    const cycle = await this.cycleRepository.getCycleByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!cycle) throw new NotFoundException("Content cycle not found");
    const resumed = await this.cycleRepository.resumeCycle(id, ownerUserId);
    return toContentCycle(resumed);
  }

  // ── GET /api/v1/content-cycles/:id ──────────────────────────────────

  async getCycle(id: string, ownerUserId: string): Promise<ContentCycle> {
    const cycle = await this.cycleRepository.getCycleByIdAndOwner(
      id,
      ownerUserId,
    );
    if (!cycle) throw new NotFoundException("Content cycle not found");
    return toContentCycle(cycle);
  }

  // ── GET /api/v1/content-cycles/:id/weeks ────────────────────────────

  async listWeeks(
    cycleId: string,
    ownerUserId: string,
  ): Promise<ContentWeekListResponse> {
    const cycle = await this.cycleRepository.getCycleByIdAndOwner(
      cycleId,
      ownerUserId,
    );
    if (!cycle) throw new NotFoundException("Content cycle not found");

    const weeks = await this.weekContextRepository.listWeeks(cycleId);
    return { weeks: weeks.map(toContentWeekContext) };
  }

  // ── GET /api/v1/content-packs/:id ───────────────────────────────────

  async getPack(id: string, ownerUserId: string): Promise<ContentPack> {
    const pack = await this.packRepository.getPackByIdAndOwner(id, ownerUserId);
    if (!pack) throw new NotFoundException("Content pack not found");
    return toContentPack(pack);
  }

  // ── GET /api/v1/content-packs/:id/progress ──────────────────────────

  async getPackProgress(
    id: string,
    ownerUserId: string,
  ): Promise<ContentProgressEvent[]> {
    const pack = await this.packRepository.getPackByIdAndOwner(id, ownerUserId);
    if (!pack) throw new NotFoundException("Content pack not found");

    const events = await this.packRepository.getProgressEvents(id);
    return events.map(toContentProgressEvent);
  }

  // ── GET /api/v1/content-packs/:id/items/:item_id/versions ───────────

  async getItemVersions(
    packId: string,
    itemId: string,
    ownerUserId: string,
  ): Promise<ContentItemVersion[]> {
    const pack = await this.packRepository.getPackByIdAndOwner(
      packId,
      ownerUserId,
    );
    if (!pack) throw new NotFoundException("Content pack not found");

    const versions = await this.packRepository.listItemVersions(packId, itemId);
    return versions.map(toContentItemVersion);
  }

  // ── GET /api/v1/content-assets/:id ──────────────────────────────────

  /**
   * Streams a stored content asset to its owner.
   *
   * Ownership is verified by walking asset → item version → pack → cycle →
   * ownerUserId, so a cross-owner asset id returns 404 rather than leaking
   * another owner's asset existence (arch doc 439-441). Only a `ready` asset
   * with a persisted storage key can be served — anything else raises
   * CONTENT_ASSET_REQUIRED. The stored bytes are re-verified against the
   * authoritative SHA-256 checksum before they leave the service, so a
   * corrupted blob never reaches the client as if it were the recorded asset.
   */
  async getAsset(
    assetId: string,
    ownerUserId: string,
  ): Promise<{ buffer: Buffer; mimeType: string | null; checksum: string }> {
    const asset = await this.packRepository.getAssetByIdAndOwner(
      assetId,
      ownerUserId,
    );
    if (!asset) {
      throw new NotFoundException("Content asset not found");
    }

    if (asset.status !== "ready" || !asset.storageKey || !asset.checksum) {
      throw new BadRequestException({
        code: "CONTENT_ASSET_REQUIRED",
        message: `Asset '${assetId}' is not ready for retrieval (status=${asset.status})`,
      });
    }

    const buffer = await this.assetStorage.retrieve(asset.storageKey);

    const actualChecksum = createHash("sha256").update(buffer).digest("hex");
    if (actualChecksum !== asset.checksum) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: `Asset '${assetId}' failed checksum verification`,
      });
    }

    return { buffer, mimeType: asset.mimeType, checksum: asset.checksum };
  }

  // ── GET /api/v1/publication-candidates/:id ──────────────────────────

  /**
   * Returns the frozen candidate payload plus its current status to the owner.
   *
   * Ownership is verified via `getCandidateByIdAndOwner` (candidate → cycle →
   * ownerUserId), so a cross-owner id returns 404. The candidate/status pair
   * is re-run through `validatePublicationCandidateHandoff` before it leaves
   * the service: a revoked or replaced candidate surfaces CONTENT_CANDIDATE_REVOKED,
   * and a payload that no longer matches its recorded checksum (mutated in the
   * DB) surfaces CONTENT_CANDIDATE_TAMPERED (arch doc 638-697).
   */
  async getPublicationCandidate(
    candidateId: string,
    ownerUserId: string,
  ): Promise<{
    candidate: PublicationCandidateV1;
    status: PublicationCandidateStatusV1;
  }> {
    const result = await this.candidateRepository.getCandidateByIdAndOwner(
      candidateId,
      ownerUserId,
    );
    if (!result) {
      throw new NotFoundException("Publication candidate not found");
    }

    const validation = validatePublicationCandidateHandoff(
      result.candidate,
      result.status,
    );
    if (!validation.valid) {
      const issue = validation.issues[0];
      throw new BadRequestException({
        code: issue?.code ?? "CONTENT_SCHEMA_FAILURE",
        message: issue?.message ?? "Publication candidate failed validation.",
        issues: validation.issues,
      });
    }

    return result;
  }

  // ── GET /api/v1/content-packs/:id/retry-eligibility ─────────────────

  async getPackRetryEligibility(
    id: string,
    ownerUserId: string,
  ): Promise<{ retry_eligible: boolean }> {
    const pack = await this.packRepository.getPackByIdAndOwner(id, ownerUserId);
    if (!pack) throw new NotFoundException("Content pack not found");
    return { retry_eligible: pack.retryEligible };
  }

  // ── POST /api/v1/content-packs/:id/retry ────────────────────────────

  /**
   * Re-queues a failed pack for generation.
   *
   * Only a pack in the `failed` state with `retry_eligible=true` can be
   * retried. The failed → queued transition is a conditional UPDATE (WHERE
   * status = 'failed'), so a concurrent retry that already moved the pack
   * sees zero rows and this call reports CONTENT_PACK_RETRY_CONFLICT instead
   * of enqueueing a duplicate job. Mirrors StrategyService.retryGeneration's
   * bounded, FSM-guarded retry.
   */
  async retryPack(
    id: string,
    ownerUserId: string,
  ): Promise<{
    content_pack: ContentPack;
    status: "queued";
    correlation_id: string;
  }> {
    const pack = await this.packRepository.getPackByIdAndOwner(id, ownerUserId);
    if (!pack) throw new NotFoundException("Content pack not found");

    if (pack.status !== "failed") {
      throw new BadRequestException({
        code: "CONTENT_PACK_NOT_FAILED",
        message: "Only a failed content pack can be retried.",
      });
    }
    if (!pack.retryEligible) {
      throw new BadRequestException({
        code: "CONTENT_RETRY_NOT_ALLOWED",
        message: "This content pack is not eligible for retry.",
      });
    }

    const { changed } = await this.packRepository.markPackStatus(
      pack.id,
      "failed",
      "queued",
    );
    if (!changed) {
      throw new ConflictException({
        code: "CONTENT_PACK_RETRY_CONFLICT",
        message:
          "The content pack is no longer failed; a retry is already in progress.",
      });
    }

    const correlationId = randomUUID();
    await this.contentQueue.add(
      "generate-content",
      {
        contentCycleId: pack.contentCycleId,
        weekNumber: pack.weekNumber,
        contentPackId: pack.id,
        idempotencyKey: `retry:${correlationId}`,
        correlationId,
      },
      { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    await this.packRepository.appendProgressEvent(pack.id, {
      stage: "queued",
      status: "started",
      messageKey: "content.retry.queued",
      messageText: "Generation job re-queued.",
      payload: { correlation_id: correlationId },
    });

    this.logger.log(
      `[ContentPack ${pack.id}] [Corr: ${correlationId}] Retry queued for week ${pack.weekNumber}.`,
    );

    return {
      content_pack: toContentPack(pack),
      status: "queued",
      correlation_id: correlationId,
    };
  }

  // ── POST /api/v1/content-packs/:id/items/:item_id/decisions ─────────

  /**
   * Records the owner's exact-version decision on one content item and, on
   * approval, freezes the publication candidate in the SAME transaction.
   *
   * Preconditions (all re-checked server-side against persisted state):
   * 1. the pack exists and belongs to the owner and is still decidable
   *    (`draft` / `partially_approved`);
   * 2. the submitted version IS the item's current version and its checksum
   *    matches the persisted version checksum (CONTENT_VERSION_CONFLICT
   *    otherwise — arch doc 559-569);
   * 3. the deterministic policy fixture validates
   *    (CONTENT_APPROVAL_BLOCKED on any blocker);
   * 4. an approval additionally requires ready publishable assets
   *    (CONTENT_ASSET_REQUIRED).
   *
   * The decision and the candidate (on approve) are written atomically, so a
   * candidate can never reference a decision/version that was not committed
   * (arch doc 826-828). Reject and revision_requested record the decision only
   * and return `publication_candidate: null`.
   */
  async decide(
    packId: string,
    itemId: string,
    dto: ContentDecisionRequest,
    ownerUserId: string,
  ): Promise<ContentDecisionResponse> {
    // revision_requested routes through requestRevision, which records the
    // decision (item → revision_requested) and enqueues the revise-content job.
    if (dto.decision === "revision_requested") {
      const { decision } = await this.requestRevision(
        packId,
        itemId,
        dto,
        ownerUserId,
      );
      return { decision, publication_candidate: null };
    }

    const pack = await this.packRepository.getPackByIdAndOwner(
      packId,
      ownerUserId,
    );
    if (!pack) throw new NotFoundException("Content pack not found");

    if (pack.status !== "draft" && pack.status !== "partially_approved") {
      throw new ConflictException({
        code: "CONTENT_APPROVAL_BLOCKED",
        message:
          "Owner decisions are only accepted while the pack is draft or partially approved.",
      });
    }

    const item = await this.packRepository.getItemById(packId, itemId);
    if (!item) throw new NotFoundException("Content item not found");
    if (!item.currentVersionId) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "The content item has no current version to decide on.",
      });
    }

    // Exact-version gate: only the item's current version can be decided, and
    // the submitted checksum must match the persisted version checksum
    // (arch doc 559-569). The repository re-checks both inside its
    // transaction; this earlier gate rejects with a clear, stable code.
    if (dto.content_item_version_id !== item.currentVersionId) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message:
          "This item version is no longer the current version. Refresh before deciding.",
      });
    }

    const versions = await this.packRepository.listItemVersions(packId, itemId);
    const currentVersion =
      versions.find((version) => version.id === item.currentVersionId) ?? null;
    if (
      !currentVersion ||
      dto.content_item_version_checksum !== currentVersion.versionChecksum
    ) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message:
          "The submitted version checksum no longer matches the current item version.",
      });
    }

    const assets = await this.packRepository.listAssetsForVersion(
      currentVersion.id,
    );
    const fixture = await this.assembleDecisionFixture(
      pack,
      item,
      currentVersion,
      assets,
      ownerUserId,
    );

    // Approvals additionally require a ready publishable asset before a
    // candidate can be frozen (CONTENT_ASSET_REQUIRED).
    if (
      dto.decision === "approved" &&
      fixture.item_version.asset_required &&
      !hasReadyPublishableAsset(fixture)
    ) {
      throw new ConflictException({
        code: "CONTENT_ASSET_REQUIRED",
        message:
          "Approval cannot produce a candidate until required assets are ready.",
      });
    }

    const validation = validateContentPolicyFixture(fixture);
    if (!validation.valid) {
      throw new ConflictException({
        code: "CONTENT_APPROVAL_BLOCKED",
        message:
          "Content approval is blocked by the deterministic content policy.",
        issues: validation.issues,
      });
    }

    const { decision, publicationCandidate, outboxEventId } =
      await this.prisma.$transaction(async (tx) => {
        const recorded = await this.decisionRepository.recordDecision(
          {
            itemId: item.id,
            versionId: dto.content_item_version_id,
            versionNumber: currentVersion.version,
            versionChecksum: dto.content_item_version_checksum,
            decision: dto.decision,
            revisionNotes: dto.revision_notes,
            ownerUserId,
            idempotencyKey: dto.idempotency_key,
          },
          tx,
        );

        if (recorded.decision !== "approved") {
          return {
            decision: recorded,
            publicationCandidate: null,
            outboxEventId: null as string | null,
          };
        }

        // Decision replay (same idempotency key) returns the original decision
        // row; return its frozen candidate instead of creating a duplicate
        // (outbox retries and replay never duplicate candidates — arch doc 651-653).
        const existingCandidate =
          await this.candidateRepository.getCandidateByItemVersionId(
            recorded.contentItemVersionId,
            tx,
          );
        if (existingCandidate) {
          return {
            decision: recorded,
            publicationCandidate: existingCandidate,
            outboxEventId: null as string | null,
          };
        }

        const created = await this.candidateRepository.createCandidate(
          {
            approval: recorded,
            itemVersion: this.candidateItemVersionInput(currentVersion),
            assets: readyCandidateAssets(fixture),
            ownerUserId,
          },
          tx,
        );

        return {
          decision: recorded,
          publicationCandidate: created.candidate,
          outboxEventId: created.outboxEventId,
        };
      });

    if (outboxEventId) {
      await this.outboxQueue.add("dispatch-outbox", {
        eventId: outboxEventId,
      });
    }

    await this.packRepository.derivePackStatusFromItems(packId);

    this.logger.log(
      `[ContentItem ${item.id}] Owner decision ${decision.decision} on version ${decision.contentItemVersion} (${decision.id}) persisted${publicationCandidate ? `; candidate ${publicationCandidate.candidate_id} created` : ""}.`,
    );

    return {
      decision: toContentDecision(decision),
      publication_candidate: publicationCandidate,
    };
  }

  // ── POST /api/v1/content-packs/:id/items/:item_id/decisions (revision) ─

  /**
   * Records a `revision_requested` owner decision and enqueues the
   * `revise-content` BullMQ job.
   *
   * Mirrors StrategyService's revision path (strategy.service.ts:416-461):
   * the decision is recorded (the decision repository flips the item to
   * `revision_requested` — arch doc 536-550) and a job is enqueued so the
   * processor (todo 24) can call FastAPI and append an immutable version N+1.
   * The prior version row is preserved by construction: content_item_versions
   * is insert-only (`@@unique([content_item_id, version])`), so a failed or
   * successful revision never mutates or deletes the base version.
   *
   * The same exact-version gates as `decide` apply — only the item's current
   * version can be revised, and the submitted checksum must match the persisted
   * version checksum (CONTENT_VERSION_CONFLICT otherwise). No approval policy
   * or asset gates apply: a revision request is the owner asking for a change,
   * not an approval.
   */
  async requestRevision(
    packId: string,
    itemId: string,
    dto: ContentDecisionRequest,
    ownerUserId: string,
  ): Promise<{ decision: ContentDecision; correlation_id: string }> {
    const pack = await this.packRepository.getPackByIdAndOwner(
      packId,
      ownerUserId,
    );
    if (!pack) throw new NotFoundException("Content pack not found");

    if (pack.status !== "draft" && pack.status !== "partially_approved") {
      throw new ConflictException({
        code: "CONTENT_APPROVAL_BLOCKED",
        message:
          "Owner decisions are only accepted while the pack is draft or partially approved.",
      });
    }

    const item = await this.packRepository.getItemById(packId, itemId);
    if (!item) throw new NotFoundException("Content item not found");
    if (!item.currentVersionId) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "The content item has no current version to revise.",
      });
    }
    if (dto.content_item_version_id !== item.currentVersionId) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message:
          "This item version is no longer the current version. Refresh before requesting a revision.",
      });
    }

    const versions = await this.packRepository.listItemVersions(packId, itemId);
    const currentVersion =
      versions.find((version) => version.id === item.currentVersionId) ?? null;
    if (
      !currentVersion ||
      dto.content_item_version_checksum !== currentVersion.versionChecksum
    ) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message:
          "The submitted version checksum no longer matches the current item version.",
      });
    }

    const decision = await this.decisionRepository.recordDecision({
      itemId: item.id,
      versionId: dto.content_item_version_id,
      versionNumber: currentVersion.version,
      versionChecksum: dto.content_item_version_checksum,
      decision: "revision_requested",
      revisionNotes: dto.revision_notes,
      ownerUserId,
      idempotencyKey: dto.idempotency_key,
    });

    const correlationId = randomUUID();
    await this.contentQueue.add(
      "revise-content",
      {
        contentCycleId: pack.contentCycleId,
        contentPackId: pack.id,
        contentItemId: item.id,
        baseItemVersionId: decision.contentItemVersionId,
        revisionNotes: dto.revision_notes ?? "",
        idempotencyKey: dto.idempotency_key,
        correlationId,
      },
      { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    this.logger.log(
      `[ContentItem ${item.id}] [Corr: ${correlationId}] Revision requested. Base version: ${decision.contentItemVersionId}`,
    );

    return {
      decision: toContentDecision(decision),
      correlation_id: correlationId,
    };
  }

  /**
   * Records owner decisions for several content items in ONE transaction.
   *
   * Pack ownership and pack status gate the whole call (same as `decide`).
   * Every entry is then partitioned per-item:
   * - eligible: exact current version + checksum match; for approves, the
   *   policy fixture and asset readiness are validated up front;
   * - ineligible: stale version/checksum, policy violation, or missing
   *   required asset — reported per-item WITHOUT rolling back the eligible
   *   entries (arch doc 113-116 bulk approval).
   *
   * The repository re-checks eligibility inside the transaction (item/version/
   * checksum and "not already decided") and reports anything it rejects as a
   * per-item error, which this method merges into the `ineligible` results.
   * Eligible decisions are written with their publication candidates in the
   * SAME transaction (candidates are replay-safe via
   * `getCandidateByItemVersionId`).
   */
  async bulkDecide(
    packId: string,
    decisions: ContentDecisionRequest[],
    ownerUserId: string,
  ): Promise<BulkDecisionItemResult[]> {
    const pack = await this.packRepository.getPackByIdAndOwner(
      packId,
      ownerUserId,
    );
    if (!pack) throw new NotFoundException("Content pack not found");

    if (pack.status !== "draft" && pack.status !== "partially_approved") {
      throw new ConflictException({
        code: "CONTENT_APPROVAL_BLOCKED",
        message:
          "Owner decisions are only accepted while the pack is draft or partially approved.",
      });
    }

    const ineligibleByItemId = new Map<string, BulkDecisionItemResult>();
    const eligible: Array<{
      request: ContentDecisionRequest;
      currentVersion: PrismaContentItemVersion;
      fixture: ContentPolicyFixture;
    }> = [];

    // Prefetch the pack-scoped inputs to the decision fixture once; the same
    // strategy, decision, version, profile, cycle, and weeks apply to every
    // item in this bulk, so re-querying them per item was N×6 round trips.
    const prefetched: DecisionFixtureCache = {
      strategy: await this.strategyRepository.getStrategyByIdAndOwner(
        pack.strategyId,
        ownerUserId,
      ),
      strategyDecision: await this.strategyRepository.getDecisionById(
        pack.strategyDecisionId,
      ),
      strategyVersion: await this.strategyRepository.getVersionByNumber(
        pack.strategyId,
        pack.strategyVersion,
      ),
      currentProfile:
        await this.strategyRepository.getActiveConfirmedProfileVersion(
          pack.businessId,
        ),
      cycle: await this.cycleRepository.getCycleByIdAndOwner(
        pack.contentCycleId,
        ownerUserId,
      ),
      weeks: await this.weekContextRepository.listWeeks(pack.contentCycleId),
    };

    for (const request of decisions) {
      const item = await this.packRepository.getItemById(
        packId,
        request.content_item_id,
      );
      if (!item) {
        ineligibleByItemId.set(request.content_item_id, {
          item_id: request.content_item_id,
          status: "ineligible",
          error: {
            code: "CONTENT_VERSION_CONFLICT",
            message: "Content item not found.",
          },
        });
        continue;
      }
      if (!item.currentVersionId) {
        ineligibleByItemId.set(request.content_item_id, {
          item_id: request.content_item_id,
          status: "ineligible",
          error: {
            code: "CONTENT_VERSION_CONFLICT",
            message: "The content item has no current version to decide on.",
          },
        });
        continue;
      }
      if (request.content_item_version_id !== item.currentVersionId) {
        ineligibleByItemId.set(request.content_item_id, {
          item_id: request.content_item_id,
          status: "ineligible",
          error: {
            code: "CONTENT_VERSION_CONFLICT",
            message:
              "This item version is no longer the current version. Refresh before deciding.",
          },
        });
        continue;
      }

      const versions = await this.packRepository.listItemVersions(
        packId,
        item.id,
      );
      const currentVersion =
        versions.find((version) => version.id === item.currentVersionId) ??
        null;
      if (
        !currentVersion ||
        request.content_item_version_checksum !== currentVersion.versionChecksum
      ) {
        ineligibleByItemId.set(request.content_item_id, {
          item_id: request.content_item_id,
          status: "ineligible",
          error: {
            code: "CONTENT_VERSION_CONFLICT",
            message:
              "The submitted version checksum no longer matches the current item version.",
          },
        });
        continue;
      }

      const assets = await this.packRepository.listAssetsForVersion(
        currentVersion.id,
      );
      const fixture = await this.assembleDecisionFixture(
        pack,
        item,
        currentVersion,
        assets,
        ownerUserId,
        prefetched,
      );

      if (
        request.decision === "approved" &&
        fixture.item_version.asset_required &&
        !hasReadyPublishableAsset(fixture)
      ) {
        ineligibleByItemId.set(request.content_item_id, {
          item_id: request.content_item_id,
          status: "ineligible",
          error: {
            code: "CONTENT_ASSET_REQUIRED",
            message:
              "Approval cannot produce a candidate until required assets are ready.",
          },
        });
        continue;
      }

      // Revision requests are the owner asking for a change, not an approval:
      // policy and asset-readiness gates do not apply (same rule as `decide`,
      // which routes revision_requested through requestRevision before any
      // fixture validation — arch doc 536-550).
      const validation = validateContentPolicyFixture(fixture);
      if (!validation.valid && request.decision !== "revision_requested") {
        ineligibleByItemId.set(request.content_item_id, {
          item_id: request.content_item_id,
          status: "ineligible",
          error: {
            code: "CONTENT_APPROVAL_BLOCKED",
            message:
              "Content approval is blocked by the deterministic content policy.",
          },
        });
        continue;
      }

      eligible.push({ request, currentVersion, fixture });
    }

    // All-ineligible batch: nothing to write.
    if (eligible.length === 0) {
      return decisions.map(
        (request) => ineligibleByItemId.get(request.content_item_id)!,
      );
    }

    const {
      decisions: recorded,
      errors,
      outboxEventIds,
    } = await this.prisma.$transaction(async (tx) => {
      const bulk = await this.decisionRepository.bulkRecordDecisions(
        eligible.map(({ request }) => ({
          itemId: request.content_item_id,
          versionId: request.content_item_version_id,
          versionChecksum: request.content_item_version_checksum,
          decision: request.decision,
          revisionNotes: request.revision_notes,
          idempotencyKey: request.idempotency_key,
        })),
        ownerUserId,
        tx,
      );

      const outboxIds: string[] = [];

      for (const decision of bulk.decisions) {
        if (decision.decision !== "approved") continue;

        const entry = eligible.find(
          (candidate) =>
            candidate.request.content_item_id === decision.contentItemId,
        );
        if (!entry) continue;

        // Replay-safe: a repeated approval returns its frozen candidate
        // instead of creating a duplicate (same rule as `decide`).
        const existingCandidate =
          await this.candidateRepository.getCandidateByItemVersionId(
            decision.contentItemVersionId,
            tx,
          );
        if (existingCandidate) continue;

        const created = await this.candidateRepository.createCandidate(
          {
            approval: decision,
            itemVersion: this.candidateItemVersionInput(entry.currentVersion),
            assets: readyCandidateAssets(entry.fixture),
            ownerUserId,
          },
          tx,
        );
        outboxIds.push(created.outboxEventId);
      }

      return { ...bulk, outboxEventIds: outboxIds };
    });

    for (const eventId of outboxEventIds) {
      await this.outboxQueue.add("dispatch-outbox", { eventId });
    }

    // Every recorded revision_requested decision enqueues a revise-content job
    // (same rule as `requestRevision`; the processor preserves the prior
    // version row — content_item_versions is insert-only).
    for (const decision of recorded) {
      if (decision.decision !== "revision_requested") continue;

      const correlationId = randomUUID();
      await this.contentQueue.add(
        "revise-content",
        {
          contentCycleId: pack.contentCycleId,
          contentPackId: pack.id,
          contentItemId: decision.contentItemId,
          baseItemVersionId: decision.contentItemVersionId,
          revisionNotes: decision.revisionNotes ?? "",
          idempotencyKey: decision.idempotencyKey ?? "",
          correlationId,
        },
        { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
      );

      this.logger.log(
        `[ContentItem ${decision.contentItemId}] [Corr: ${correlationId}] Revision requested (bulk). Base version: ${decision.contentItemVersionId}`,
      );
    }

    const decisionByItemId = new Map(
      recorded.map((decision) => [decision.contentItemId, decision]),
    );
    const errorByItemId = new Map(errors.map((error) => [error.itemId, error]));

    await this.packRepository.derivePackStatusFromItems(packId);

    return decisions.map((request) => {
      const ineligible = ineligibleByItemId.get(request.content_item_id);
      if (ineligible) return ineligible;

      const repoError = errorByItemId.get(request.content_item_id);
      if (repoError) {
        return {
          item_id: request.content_item_id,
          status: "ineligible",
          error: { code: repoError.code, message: repoError.message },
        };
      }

      const decision = decisionByItemId.get(request.content_item_id);
      return {
        item_id: request.content_item_id,
        status: decision ? decision.decision : "ineligible",
      };
    });
  }

  private candidateItemVersionInput(
    currentVersion: PrismaContentItemVersion,
  ): CreateCandidateInput["itemVersion"] {
    return {
      id: currentVersion.id,
      contentItemId: currentVersion.contentItemId,
      contentPackId: currentVersion.contentPackId,
      version: currentVersion.version,
      versionChecksum: currentVersion.versionChecksum,
      channel: currentVersion.channel,
      format: currentVersion.format,
      languageMode: currentVersion.languageMode,
      captionVariants: currentVersion.captionVariants as Prisma.InputJsonValue,
      cta: currentVersion.cta,
      hashtags: currentVersion.hashtags as Prisma.InputJsonValue,
      altText: currentVersion.altText,
      recommendedPublishWindow:
        currentVersion.recommendedPublishWindow as Prisma.InputJsonValue,
    };
  }

  private async assembleDecisionFixture(
    pack: PrismaContentPack,
    item: NonNullable<
      Awaited<ReturnType<ContentPackRepository["getItemById"]>>
    >,
    currentVersion: PrismaContentItemVersion,
    assets: PrismaContentAsset[],
    ownerUserId: string,
    prefetched?: DecisionFixtureCache,
  ): Promise<ContentPolicyFixture> {
    const strategy =
      prefetched?.strategy ??
      (await this.strategyRepository.getStrategyByIdAndOwner(
        pack.strategyId,
        ownerUserId,
      ));
    const strategyDecision =
      prefetched?.strategyDecision ??
      (await this.strategyRepository.getDecisionById(pack.strategyDecisionId));
    const strategyVersion =
      prefetched?.strategyVersion ??
      (await this.strategyRepository.getVersionByNumber(
        pack.strategyId,
        pack.strategyVersion,
      ));
    const currentProfile =
      prefetched?.currentProfile ??
      (await this.strategyRepository.getActiveConfirmedProfileVersion(
        pack.businessId,
      ));
    const cycle =
      prefetched?.cycle ??
      (await this.cycleRepository.getCycleByIdAndOwner(
        pack.contentCycleId,
        ownerUserId,
      ));
    const weeks =
      prefetched?.weeks ??
      (await this.weekContextRepository.listWeeks(pack.contentCycleId));
    const weekContext = weeks.find((week) => week.id === pack.weekContextId);
    if (!weekContext) {
      throw new NotFoundException("Content week context not found");
    }

    return {
      strategy_status:
        strategy?.status === "approved"
          ? "approved"
          : strategy?.status === "rejected"
            ? "rejected"
            : "draft",
      strategy_id: pack.strategyId,
      strategy_version: pack.strategyVersion,
      strategy_decision: {
        id: strategyDecision?.id ?? pack.strategyDecisionId,
        strategy_id: pack.strategyId,
        strategy_version: pack.strategyVersion,
        decision: normalizeStrategyDecision(strategyDecision?.action),
      },
      cycle_status: cycle?.status as ContentCycleStatus,
      profile_version_id: pack.profileVersionId,
      current_profile_version_id: currentProfile?.id ?? "",
      selected_channels: planSelectedChannels(strategyVersion?.planData),
      existing_weekly_claims: weeks.map((week) => ({
        content_cycle_id: week.contentCycleId,
        week_number: week.weekNumber,
        weekly_claim_id: week.weeklyClaimId,
      })),
      week_context: toContentWeekContext(weekContext),
      pack: toContentPack(pack),
      item_version: toContentItemVersion(currentVersion),
      assets: assets.map(toContentAsset),
    };
  }

  private assertCycleActive(cycle: ContentCycleRow): void {
    if (cycle.status === "paused") {
      throw new ConflictException({
        code: "CONTENT_CYCLE_PAUSED",
        message:
          "The content cycle is paused; resume it before updating week context.",
      });
    }
    if (cycle.status === "completed") {
      throw new ConflictException({
        code: "CONTENT_CYCLE_COMPLETED",
        message:
          "The content cycle is completed; week context cannot be updated.",
      });
    }
  }

  private assertWeekNumberInRange(weekNumber: number): void {
    if (weekNumber < 1 || weekNumber > 12) {
      throw new BadRequestException({
        code: "CONTENT_WEEK_OUT_OF_RANGE",
        message: `Week number must be between 1 and 12 (received ${weekNumber}).`,
      });
    }
  }
}

// ── Contract mappers ─────────────────────────────────────────────────

function toContentCycle(cycle: ContentCycleRow): ContentCycle {
  return {
    id: cycle.id,
    contract_version: "content-v1",
    business_id: cycle.businessId,
    strategy_id: cycle.strategyId,
    strategy_version: cycle.strategyVersion,
    strategy_decision_id: cycle.strategyDecisionId,
    profile_version_id: cycle.profileVersionId,
    status: cycle.status as ContentCycle["status"],
    current_week_number: cycle.currentWeekNumber,
    next_generation_at: cycle.nextGenerationAt
      ? cycle.nextGenerationAt.toISOString()
      : null,
    timezone: cycle.timezone as CairoTimezone,
    pause_reason: cycle.pauseReason,
    completed_at: cycle.completedAt ? cycle.completedAt.toISOString() : null,
    created_at: cycle.createdAt.toISOString(),
    updated_at: cycle.updatedAt.toISOString(),
  };
}

export function toContentWeekContext(
  week: PrismaWeekContext,
): ContentWeekContext {
  const base = {
    id: week.id,
    contract_version: "content-v1" as const,
    content_cycle_id: week.contentCycleId,
    week_number: week.weekNumber,
    week_start_date: toIsoDate(week.weekStartDate),
    promotion_mode: week.promotionMode as "none" | "owner_approved",
    promotion: week.promotion as unknown as ContentPromotion | null,
    must_include: toJsonStringArray(week.mustInclude),
    must_avoid: toJsonStringArray(week.mustAvoid),
    approved_asset_ids: toJsonStringArray(week.approvedAssetIds),
    cta_destination: week.ctaDestination as ContentCtaDestination,
    generation_cutoff_at: week.generationCutoffAt.toISOString(),
    weekly_claim_id: week.weeklyClaimId,
  };

  if (week.contextSource === "owner_confirmed") {
    if (week.confirmedByUserId === null || week.confirmedAt === null) {
      throw new Error(
        `Week context ${week.id} is marked owner_confirmed but is missing confirmation fields`,
      );
    }
    return {
      ...base,
      context_source: "owner_confirmed",
      confirmed_by_user_id: week.confirmedByUserId,
      confirmed_at: week.confirmedAt.toISOString(),
      system_defaulted_at: null,
    };
  }

  if (week.systemDefaultedAt === null) {
    throw new Error(
      `Week context ${week.id} is marked system_defaulted but is missing system_defaulted_at`,
    );
  }
  return {
    ...base,
    context_source: "system_defaulted",
    confirmed_by_user_id: null,
    confirmed_at: null,
    system_defaulted_at: week.systemDefaultedAt.toISOString(),
  };
}

export function toContentPack(pack: PrismaContentPack): ContentPack {
  return {
    id: pack.id,
    contract_version: pack.contractVersion as ContentPack["contract_version"],
    content_cycle_id: pack.contentCycleId,
    weekly_claim_id: pack.weeklyClaimId,
    week_number: pack.weekNumber,
    business_id: pack.businessId,
    strategy_id: pack.strategyId,
    strategy_version: pack.strategyVersion,
    strategy_decision_id: pack.strategyDecisionId,
    profile_version_id: pack.profileVersionId,
    week_context_id: pack.weekContextId,
    status: pack.status as ContentPack["status"],
    retry_eligible: pack.retryEligible,
    item_ids: toJsonStringArray(pack.itemIds),
    created_at: pack.createdAt.toISOString(),
    updated_at: pack.updatedAt.toISOString(),
  };
}

function toContentProgressEvent(
  event: PersistedContentProgressEvent,
): ContentProgressEvent {
  return {
    type: "content_progress",
    content_pack_id: event.contentPackId,
    seq: event.seq,
    stage: event.stage as ContentProgressEvent["stage"],
    status: event.status as ContentProgressEvent["status"],
    message_key: event.messageKey,
    message_text: event.messageText,
    payload: (event.payload ?? {}) as Record<string, unknown>,
    created_at: event.createdAt.toISOString(),
  };
}

export function toContentItemVersion(
  version: PrismaContentItemVersion,
): ContentItemVersion {
  return {
    id: version.id,
    contract_version: "content-v1",
    content_item_id: version.contentItemId,
    content_pack_id: version.contentPackId,
    version: version.version,
    channel: version.channel as ContentItemVersion["channel"],
    format: version.format as ContentItemVersion["format"],
    language_mode: version.languageMode as ContentItemVersion["language_mode"],
    strategy_trace:
      version.strategyTrace as unknown as ContentItemVersion["strategy_trace"],
    caption_variants:
      version.captionVariants as unknown as ContentItemVersion["caption_variants"],
    cta: version.cta,
    hashtags: toJsonStringArray(version.hashtags),
    creative_brief: version.creativeBrief,
    alt_text: version.altText,
    short_video_script:
      version.shortVideoScript as unknown as ContentItemVersion["short_video_script"],
    recommended_publish_window:
      version.recommendedPublishWindow as unknown as ContentItemVersion["recommended_publish_window"],
    claim_sources:
      version.claimSources as unknown as ContentItemVersion["claim_sources"],
    warnings: version.warnings as unknown as ContentItemVersion["warnings"],
    blockers: version.blockers as unknown as ContentItemVersion["blockers"],
    asset_required: version.assetRequired,
    asset_ids: toJsonStringArray(version.assetIds),
    generation_provenance:
      version.generationProvenance as ContentItemVersion["generation_provenance"],
    version_checksum: version.versionChecksum,
    created_at: version.createdAt.toISOString(),
  };
}

function toContentDecision(row: ContentDecisionRow): ContentDecision {
  return {
    id: row.id,
    content_item_id: row.contentItemId,
    content_item_version_id: row.contentItemVersionId,
    content_item_version: row.contentItemVersion,
    content_item_version_checksum: row.contentItemVersionChecksum,
    decision: row.decision,
    revision_notes: row.revisionNotes,
    decided_by_user_id: row.decidedByUserId,
    decided_at: row.decidedAt.toISOString(),
  };
}

export function toContentAsset(row: PrismaContentAsset): ContentAsset {
  return {
    id: row.id,
    content_item_version_id: row.contentItemVersionId,
    kind: row.kind as ContentAsset["kind"],
    status: row.status as ContentAsset["status"],
    mime_type: row.mimeType,
    storage_key: row.storageKey,
    checksum: row.checksum,
    width: row.width,
    height: row.height,
    alt_text: row.altText,
    provider_name: row.providerName,
    provider_model: row.providerModel,
    provider_request_id: row.providerRequestId,
    failure_code: row.failureCode as ContentAsset["failure_code"],
    created_at: row.createdAt.toISOString(),
  };
}

function hasReadyPublishableAsset(fixture: ContentPolicyFixture): boolean {
  const assetsById = new Map(fixture.assets.map((asset) => [asset.id, asset]));
  return fixture.item_version.asset_ids.some((assetId) => {
    const asset = assetsById.get(assetId);
    return (
      asset?.status === "ready" &&
      (asset.kind === "owner_supplied" || asset.kind === "generated_static") &&
      asset.checksum !== null &&
      asset.storage_key !== null
    );
  });
}

function readyCandidateAssets(
  fixture: ContentPolicyFixture,
): PublicationCandidateAssetInput[] {
  const assetsById = new Map(fixture.assets.map((asset) => [asset.id, asset]));
  return fixture.item_version.asset_ids
    .map((assetId) => assetsById.get(assetId))
    .filter(
      (
        asset,
      ): asset is ContentAsset & {
        kind: "owner_supplied" | "generated_static";
      } =>
        asset !== undefined &&
        asset.status === "ready" &&
        (asset.kind === "owner_supplied" ||
          asset.kind === "generated_static") &&
        asset.checksum !== null &&
        asset.storage_key !== null,
    )
    .map((asset) => ({
      assetId: asset.id,
      kind: asset.kind,
      mimeType: asset.mime_type ?? "",
      storageKey: asset.storage_key ?? "",
      checksum: asset.checksum ?? "",
    }));
}

export function planSelectedChannels(planData: unknown): ContentChannel[] {
  const plan = toPayload(planData);
  const selected = plan.selected_channels;
  if (!Array.isArray(selected)) return [];
  // MVP content pipeline supports facebook + instagram only; other channels in
  // the strategy scorecard are intentionally dropped here. Lift this allowlist
  // when the content processor and asset providers gain the new formats.
  return selected
    .map((scorecard) =>
      typeof scorecard === "object" && scorecard !== null
        ? (scorecard as { channel?: unknown }).channel
        : undefined,
    )
    .filter(
      (channel): channel is ContentChannel =>
        channel === "facebook" || channel === "instagram",
    );
}

export function normalizeStrategyDecision(
  action: string | null | undefined,
): "approved" | "rejected" | "revision_requested" {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  if (action === "revision_requested") return "revision_requested";
  return "revision_requested";
}

export function toPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type ContentCycleRow = Awaited<
  ReturnType<ContentCycleRepository["createCycle"]>
>;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
