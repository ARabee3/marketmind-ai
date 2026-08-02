import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ContentWeekContext } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../common/persistence/prisma.service";
import type { ContentWeekContextOwnerInput } from "@marketmind/contracts";

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
   * `nextGenerationAt`.
   */
  async upsertOwnerContext(
    cycleId: string,
    ownerInput: ContentWeekContextOwnerInput,
    ownerUserId: string,
  ): Promise<ContentWeekContext> {
    const cycle = await this.prisma.contentCycle.findFirst({
      where: { id: cycleId },
      select: { nextGenerationAt: true },
    });
    if (!cycle || !cycle.nextGenerationAt) {
      throw new NotFoundException(
        "Content cycle not found or has no generation cutoff",
      );
    }

    return this.prisma.contentWeekContext.upsert({
      where: {
        contentCycleId_weekNumber: {
          contentCycleId: cycleId,
          weekNumber: ownerInput.week_number,
        },
      },
      create: {
        contentCycleId: cycleId,
        weekNumber: ownerInput.week_number,
        weekStartDate: ownerInput.week_start_date,
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
        generationCutoffAt: cycle.nextGenerationAt,
        weeklyClaimId: randomUUID(),
        contextSource: "owner_confirmed",
        confirmedByUserId: ownerUserId,
        confirmedAt: new Date(),
      },
      update: {
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
        generationCutoffAt: cycle.nextGenerationAt,
        confirmedByUserId: ownerUserId,
        confirmedAt: new Date(),
      },
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
    const cycle = await this.prisma.contentCycle.findUnique({
      where: { id: cycleId },
      include: {
        profileVersion: {
          select: { profile: true },
        },
      },
    });
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }

    const approvedAssetIds = await this.priorApprovedAssetIds(cycleId);

    const ctaDestination = deriveSafeDefaultCta(
      cycle.profileVersion?.profile,
    );

    return this.claimWeek(cycleId, weekNumber, randomUUID(), {
      weekStartDate: input.weekStartDate,
      promotionMode: "none",
      promotion: Prisma.JsonNull,
      mustInclude: [] as Prisma.InputJsonValue,
      mustAvoid: [] as Prisma.InputJsonValue,
      approvedAssetIds: approvedAssetIds as Prisma.InputJsonValue,
      ctaDestination,
      generationCutoffAt: input.cutoffAt,
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

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
