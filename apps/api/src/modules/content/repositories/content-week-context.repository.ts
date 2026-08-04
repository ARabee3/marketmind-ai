import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ContentWeekContext } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../common/persistence/prisma.service";
import type { ContentWeekContextOwnerInput } from "@marketmind/contracts";
import { weekCutoffDate, weekStartDate } from "../content-schedule";

type WeekContextCreateData = Omit<
  Prisma.ContentWeekContextUncheckedCreateInput,
  "id" | "contentCycleId" | "weekNumber" | "weeklyClaimId" | "createdAt"
>;

export type SafeDefaultContextInput = {
  readonly weekStartDate: Date;
  readonly cutoffAt: Date;
};

/**
 * Repository for weekly content contexts.
 *
 * The week context row for a (cycle, week) is created exactly once: the
 * `@@unique([content_cycle_id, week_number])` constraint makes the first
 * insert the winner and every concurrent insert returns the existing row.
 * That single-insert semantics is the `claimWeek` primitive below, shared by
 * the owner-confirmed upsert path and the system safe-default path.
 */
@Injectable()
export class ContentWeekContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an owner-confirmed week context. The owner may update next
   * week's context until the week is claimed, so this is an upsert keyed on
   * (cycle, week). The weekly claim id and generation cutoff are computed
   * here (not trusted from the client): cutoff comes from the cycle's
   * the immutable Week-1 schedule anchor.
   */
  async upsertOwnerContext(
    cycleId: string,
    ownerInput: ContentWeekContextOwnerInput,
    ownerUserId: string,
  ): Promise<ContentWeekContext> {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.contentCycle.findUnique({
        where: { id: cycleId },
        select: { week1StartDate: true },
      });
      if (!cycle) {
        throw new NotFoundException("Content cycle not found");
      }

      const computedWeekStart = weekStartDate(
        cycle.week1StartDate,
        ownerInput.week_number,
      );
      const computedCutoff = weekCutoffDate(
        cycle.week1StartDate,
        ownerInput.week_number,
      );
      const existing = await tx.contentWeekContext.findUnique({
        where: {
          contentCycleId_weekNumber: {
            contentCycleId: cycleId,
            weekNumber: ownerInput.week_number,
          },
        },
      });

      const data = {
        promotionMode: ownerInput.promotion_mode,
        promotion:
          ownerInput.promotion === null
            ? Prisma.JsonNull
            : (ownerInput.promotion as Prisma.InputJsonValue),
        mustInclude: ownerInput.must_include as Prisma.InputJsonValue,
        mustAvoid: ownerInput.must_avoid as Prisma.InputJsonValue,
        approvedAssetIds:
          ownerInput.approved_asset_ids as Prisma.InputJsonValue,
        ctaDestination: ownerInput.cta_destination as Prisma.InputJsonValue,
        confirmedByUserId: ownerUserId,
        confirmedAt: new Date(),
      };

      if (!existing) {
        try {
          return await tx.contentWeekContext.create({
            data: {
              ...data,
              contentCycleId: cycleId,
              weekNumber: ownerInput.week_number,
              weekStartDate: dateOnlyAtUtcMidnight(computedWeekStart),
              generationCutoffAt: computedCutoff,
              weeklyClaimId: randomUUID(),
              contextSource: "owner_confirmed",
            },
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const claimed = await tx.contentWeekContext.findUniqueOrThrow({
            where: {
              contentCycleId_weekNumber: {
                contentCycleId: cycleId,
                weekNumber: ownerInput.week_number,
              },
            },
          });
          if (
            claimed.contextSource === "system_defaulted" ||
            claimed.frozenAt
          ) {
            throw contextFrozen(ownerInput.week_number);
          }
          return claimed;
        }
      }

      if (existing.contextSource === "system_defaulted" || existing.frozenAt) {
        throw contextFrozen(ownerInput.week_number);
      }

      const updated = await tx.contentWeekContext.updateMany({
        where: { id: existing.id, frozenAt: null },
        data,
      });
      if (updated.count === 0) {
        throw contextFrozen(ownerInput.week_number);
      }
      return tx.contentWeekContext.findUniqueOrThrow({
        where: { id: existing.id },
      });
    });
  }

  /**
   * Inserts the explicit safe default for a week whose optional owner
   * context was never confirmed before the cutoff (arch doc 193-244).
   *
   * Rules enforced here: no promotion (mode `none`, no promotion object),
   * empty must-include/must-avoid, reusable assets from prior approved packs
   * only, and a CTA destination derived from already-confirmed business data.
   * Expiring offers and unconfirmed operational facts are never carried in.
   */
  async createSafeDefaultContext(
    cycleId: string,
    weekNumber: number,
    input: SafeDefaultContextInput,
  ): Promise<ContentWeekContext> {
    void input;
    const cycle = await this.prisma.contentCycle.findUnique({
      where: { id: cycleId },
      select: {
        week1StartDate: true,
        profileVersion: {
          select: { profile: true },
        },
      },
    });
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }

    const approvedAssetIds = await this.priorApprovedAssetIds(cycleId);
    const computedWeekStart = weekStartDate(cycle.week1StartDate, weekNumber);
    const computedCutoff = weekCutoffDate(cycle.week1StartDate, weekNumber);

    const ctaDestination = deriveSafeDefaultCta(cycle.profileVersion?.profile);

    return this.claimWeek(cycleId, weekNumber, randomUUID(), {
      weekStartDate: dateOnlyAtUtcMidnight(computedWeekStart),
      promotionMode: "none",
      promotion: Prisma.JsonNull,
      mustInclude: [] as Prisma.InputJsonValue,
      mustAvoid: [] as Prisma.InputJsonValue,
      approvedAssetIds: approvedAssetIds as Prisma.InputJsonValue,
      ctaDestination,
      generationCutoffAt: computedCutoff,
      contextSource: "system_defaulted",
      systemDefaultedAt: new Date(),
    });
  }

  async listWeeks(cycleId: string): Promise<ContentWeekContext[]> {
    return this.prisma.contentWeekContext.findMany({
      where: { contentCycleId: cycleId },
      orderBy: { weekNumber: "asc" },
    });
  }

  async getWeekById(id: string): Promise<ContentWeekContext | null> {
    return this.prisma.contentWeekContext.findUnique({ where: { id } });
  }

  /**
   * Atomic claim of a (cycle, week): a conditional INSERT guarded by
   * `@@unique([content_cycle_id, week_number])`. The first insert wins; a
   * concurrent insert hits P2002 and returns the existing row, so two
   * callers (scheduler + manual) always resolve to the same week context.
   */
  async claimWeek(
    cycleId: string,
    weekNumber: number,
    claimId: string,
    data: WeekContextCreateData,
  ): Promise<ContentWeekContext> {
    try {
      return await this.prisma.contentWeekContext.create({
        data: {
          ...data,
          contentCycleId: cycleId,
          weekNumber,
          weeklyClaimId: claimId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.contentWeekContext.findUnique({
          where: {
            contentCycleId_weekNumber: { contentCycleId: cycleId, weekNumber },
          },
        });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async priorApprovedAssetIds(cycleId: string): Promise<string[]> {
    const assets = await this.prisma.contentAsset.findMany({
      where: {
        contentItemVersion: {
          contentPack: {
            contentCycleId: cycleId,
            status: "approved",
          },
        },
      },
      select: { id: true },
    });
    return assets.map((asset) => asset.id);
  }
}

/**
 * Selects a CTA destination from already-confirmed business data only.
 * The persisted confirmed profile exposes an optional `address_text`; any
 * other contact surface (phone, website) is not part of the confirmed data
 * and must never be invented, so the fallback is `none`.
 */
export function deriveSafeDefaultCta(
  profile: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue {
  const record = isRecord(profile) ? profile : {};
  const addressText = record["address_text"];
  if (typeof addressText === "string" && addressText.trim().length > 0) {
    return { type: "address", value: addressText };
  }
  return { type: "none", value: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateOnlyAtUtcMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function contextFrozen(weekNumber: number): ConflictException {
  return new ConflictException({
    code: "CONTENT_WEEK_ALREADY_CLAIMED",
    message: `Week ${weekNumber} context is frozen and cannot be changed.`,
  });
}
