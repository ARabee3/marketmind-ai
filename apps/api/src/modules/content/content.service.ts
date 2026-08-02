import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import type {
  CairoTimezone,
  ContentCtaDestination,
  ContentCycle,
  ContentCycleResponse,
  ContentPack,
  ContentPromotion,
  ContentWeekContext,
  CreateContentCycleRequest,
  GenerateContentPackRequest,
  UpsertContentWeekContextRequest,
} from "@marketmind/contracts";
import type { ContentWeekContext as PrismaWeekContext } from "@prisma/client";
import type { ContentPack as PrismaContentPack } from "@prisma/client";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { StrategyRepository } from "../strategy/strategy.repository";

const CAIRO_TIMEZONE = "Africa/Cairo" as const;

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly cycleRepository: ContentCycleRepository,
    private readonly weekContextRepository: ContentWeekContextRepository,
    private readonly strategyRepository: StrategyRepository,
    private readonly packRepository: ContentPackRepository,
    @InjectQueue("content-generation") private readonly contentQueue: Queue,
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
      !currentVersion
      || currentVersion.strategyId !== strategy.id
      || currentVersion.version !== dto.strategy_version
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
    if (!briefProfileId || !latestProfile || latestProfile.id !== briefProfileId) {
      throw new ConflictException({
        code: "CONTENT_PROFILE_STALE",
        message:
          "The confirmed Business Profile changed after the approved Strategy was saved. Refresh the profile before starting Content.",
      });
    }

    // Week 1 starts on the Strategy brief's start date. The generation cutoff
    // for week 1 is the end of the current Strategy week (start of week 2),
    // so the next draft is available before the next week begins (arch doc
    // 482-489). The exact clock time is configuration, not an LLM decision.
    const week1StartIso = toCairoIsoDate(strategy.brief.startDate);
    const nextGenerationAt = startOfCairoDay(addDaysIso(week1StartIso, 7));

    const cycle = await this.cycleRepository.createCycle(
      {
        businessId: strategy.businessId,
        strategyId: strategy.id,
        strategyVersion: currentVersion.version,
        strategyDecisionId: dto.strategy_decision_id,
        profileVersionId: briefProfileId,
        idempotencyKey: dto.idempotency_key,
        nextGenerationAt,
      },
      ownerUserId,
    );

    // The initial week context comes from the owner's confirmed input, but the
    // server is authoritative for week number and start date.
    const initialWeekContext = await this.weekContextRepository.upsertOwnerContext(
      cycle.id,
      {
        ...dto.initial_week_context,
        week_number: 1,
        week_start_date: week1StartIso,
      },
      ownerUserId,
    );

    this.logger.log(
      `[ContentCycle ${cycle.id}] Created from approved Strategy ${strategy.id} v${currentVersion.version} for week 1 (cutoff ${nextGenerationAt.toISOString()}).`,
    );

    return {
      content_cycle: toContentCycle(cycle),
      initial_week_context: toContentWeekContext(initialWeekContext),
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

    const nextGenerationAt = cycle.nextGenerationAt;
    if (!nextGenerationAt) {
      throw new NotFoundException("Content cycle has no generation cutoff");
    }

    // The week's generation cutoff is the start of the following week. Once it
    // has passed, the scheduler owns the week (arch doc 193-244).
    const cutoff = weekCutoffFor(nextGenerationAt, weekNumber);
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
    if (existing && existing.contextSource === "system_defaulted") {
      throw new ConflictException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Week ${weekNumber} was already claimed by the system safe default.`,
      });
    }

    const persisted = await this.weekContextRepository.upsertOwnerContext(
      cycleId,
      {
        ...dto,
        week_number: weekNumber,
        week_start_date: weekStartFor(nextGenerationAt, weekNumber),
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

    const nextGenerationAt = cycle.nextGenerationAt;
    if (!nextGenerationAt) {
      throw new NotFoundException("Content cycle has no generation cutoff");
    }

    const persisted = await this.weekContextRepository.createSafeDefaultContext(
      cycleId,
      weekNumber,
      {
        weekStartDate: startOfCairoDay(weekStartFor(nextGenerationAt, weekNumber)),
        cutoffAt: weekCutoffFor(nextGenerationAt, weekNumber),
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
      // Idempotent replay: the week is already claimed; return the existing
      // pack without enqueuing a duplicate job (arch doc 932-933).
      return {
        content_pack: toContentPack(pack),
        status: "queued",
        correlation_id: correlationId,
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

function toContentWeekContext(week: PrismaWeekContext): ContentWeekContext {
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
    return {
      ...base,
      context_source: "owner_confirmed",
      confirmed_by_user_id: week.confirmedByUserId as string,
      confirmed_at: (week.confirmedAt as Date).toISOString(),
      system_defaulted_at: null,
    };
  }

  return {
    ...base,
    context_source: "system_defaulted",
    confirmed_by_user_id: null,
    confirmed_at: null,
    system_defaulted_at: (week.systemDefaultedAt as Date).toISOString(),
  };
}

function toContentPack(pack: PrismaContentPack): ContentPack {
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

type ContentCycleRow = Awaited<
  ReturnType<ContentCycleRepository["createCycle"]>
>;

// ── Africa/Cairo date helpers ────────────────────────────────────────

function toCairoIsoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Cannot format Cairo date for ${date.toISOString()}`);
  }
  return `${year}-${month}-${day}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day + days);
  return toCairoIsoDate(new Date(utcMidnight));
}

/**
 * Week 1 starts on the Strategy brief's start date; `nextGenerationAt` is the
 * start of week 2. Week N therefore starts `(N - 2)` weeks after
 * `nextGenerationAt`, and its generation cutoff is the start of the following
 * week (`(N - 1)` weeks after `nextGenerationAt`).
 */
function weekStartFor(nextGenerationAt: Date, weekNumber: number): string {
  return addDaysIso(toCairoIsoDate(nextGenerationAt), (weekNumber - 2) * 7);
}

function weekCutoffFor(nextGenerationAt: Date, weekNumber: number): Date {
  return startOfCairoDay(
    addDaysIso(toCairoIsoDate(nextGenerationAt), (weekNumber - 1) * 7),
  );
}

/**
 * Returns the UTC instant of Cairo midnight for the given local calendar date.
 * Cairo is UTC+2 (or UTC+3 during DST), so midnight is 21:00/22:00 UTC of the
 * previous day; scanning from 20:00 UTC covers both offsets.
 */
function startOfCairoDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  let candidate = Date.UTC(year, month - 1, day - 1, 20);
  while (toCairoIsoDate(new Date(candidate)) !== isoDate) {
    candidate += 60 * 60 * 1000;
  }
  return new Date(candidate);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
