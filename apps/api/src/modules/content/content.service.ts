import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CairoTimezone,
  ContentCtaDestination,
  ContentCycle,
  ContentCycleResponse,
  ContentPromotion,
  ContentWeekContext,
  CreateContentCycleRequest,
} from "@marketmind/contracts";
import type { ContentWeekContext as PrismaWeekContext } from "@prisma/client";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { StrategyRepository } from "../strategy/strategy.repository";

const CAIRO_TIMEZONE = "Africa/Cairo" as const;

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly cycleRepository: ContentCycleRepository,
    private readonly weekContextRepository: ContentWeekContextRepository,
    private readonly strategyRepository: StrategyRepository,
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
