import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, ContentPack } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { canTransitionContentPack, ContentPackStatus } from "@marketmind/contracts";

export type ContentItemVersionDraftInput = {
  readonly channel: string;
  readonly format: string;
  readonly languageMode: string;
  readonly strategyTrace: Prisma.InputJsonValue;
  readonly captionVariants: Prisma.InputJsonValue;
  readonly cta: string | null;
  readonly hashtags: Prisma.InputJsonValue;
  readonly creativeBrief: string;
  readonly altText: string;
  readonly shortVideoScript: Prisma.InputJsonValue | null;
  readonly recommendedPublishWindow: Prisma.InputJsonValue;
  readonly claimSources: Prisma.InputJsonValue;
  readonly warnings: Prisma.InputJsonValue;
  readonly blockers: Prisma.InputJsonValue;
  readonly assetRequired: boolean;
  readonly assetIds: Prisma.InputJsonValue;
  readonly generationProvenance: Prisma.InputJsonValue;
  readonly versionChecksum: string;
};

export type AppendPackWithItemsInput = {
  readonly cycleId: string;
  readonly weekNumber: number;
  readonly weekContextId: string;
  readonly items: ContentItemVersionDraftInput[];
  readonly generationRunId: string;
};

export type ContentProgressInput = {
  readonly stage: string;
  readonly status: "started" | "progress" | "complete" | "failed";
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload?: Record<string, unknown>;
};

/**
 * Repository for content packs.
 *
 * `appendPackWithItems` is the atomic weekly claim: inserting the pack row is
 * guarded by `@@unique([content_cycle_id, week_number])`, so a scheduler and a
 * manual request share one claim — the first insert wins and a concurrent one
 * hits P2002 and returns the existing pack (arch doc 731-734, 932-933).
 */
@Injectable()
export class ContentPackRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the pack, its items and their first immutable versions, the
   * generation run, and links each item's current_version_id — all in one
   * transaction. Item version rows are insert-only: this method never mutates
   * an existing content_item_versions row.
   */
  async appendPackWithItems(
    input: AppendPackWithItemsInput,
  ): Promise<ContentPack> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cycle = await tx.contentCycle.findUniqueOrThrow({
          where: { id: input.cycleId },
          select: {
            businessId: true,
            strategyId: true,
            strategyVersion: true,
            strategyDecisionId: true,
            profileVersionId: true,
          },
        });

        const pack = await tx.contentPack.create({
          data: {
            contentCycleId: input.cycleId,
            weeklyClaimId: randomUUID(),
            weekNumber: input.weekNumber,
            businessId: cycle.businessId,
            strategyId: cycle.strategyId,
            strategyVersion: cycle.strategyVersion,
            strategyDecisionId: cycle.strategyDecisionId,
            profileVersionId: cycle.profileVersionId,
            weekContextId: input.weekContextId,
            status: "queued",
            retryEligible: true,
            itemIds: [],
          },
        });

        const itemIds: string[] = [];
        for (const [index, draft] of input.items.entries()) {
          const item = await tx.contentItem.create({
            data: {
              contentPackId: pack.id,
              status: "draft",
            },
          });
          itemIds.push(item.id);

          const version = await tx.contentItemVersion.create({
            data: {
              contentItemId: item.id,
              contentPackId: pack.id,
              version: 1,
              channel: draft.channel,
              format: draft.format,
              languageMode: draft.languageMode,
              strategyTrace: draft.strategyTrace,
              captionVariants: draft.captionVariants,
              cta: draft.cta,
              hashtags: draft.hashtags,
              creativeBrief: draft.creativeBrief,
              altText: draft.altText,
              shortVideoScript: draft.shortVideoScript,
              recommendedPublishWindow: draft.recommendedPublishWindow,
              claimSources: draft.claimSources,
              warnings: draft.warnings,
              blockers: draft.blockers,
              assetRequired: draft.assetRequired,
              assetIds: draft.assetIds,
              generationProvenance: draft.generationProvenance,
              versionChecksum: draft.versionChecksum,
            },
          });

          await tx.contentItem.update({
            where: { id: item.id },
            data: { currentVersionId: version.id },
          });

          void index;
        }

        await tx.contentPack.update({
          where: { id: pack.id },
          data: { itemIds },
        });

        await tx.contentGenerationRun.create({
          data: {
            id: input.generationRunId,
            contentPackId: pack.id,
            contentCycleId: input.cycleId,
            weekNumber: input.weekNumber,
            runType: "generate",
            status: "queued",
            startedAt: new Date(),
          },
        });

        return pack;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.contentPack.findUnique({
          where: {
            contentCycleId_weekNumber: {
              contentCycleId: input.cycleId,
              weekNumber: input.weekNumber,
            },
          },
        });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Atomic weekly claim for the request/scheduler path (arch doc 731-734):
   * creates a queued pack row with an empty item list. The
   * `@@unique([content_cycle_id, week_number])` constraint makes a concurrent
   * duplicate insert return the existing pack, so the scheduler and a manual
   * generate request always resolve to the same pack (arch doc 932-933).
   * `created` tells the caller whether it won the claim, so only the winner
   * enqueues a generation job.
   */
  async claimQueuedPack(
    cycleId: string,
    weekNumber: number,
    weekContextId: string,
  ): Promise<{ pack: ContentPack; created: boolean }> {
    try {
      const pack = await this.prisma.$transaction(async (tx) => {
        const cycle = await tx.contentCycle.findUniqueOrThrow({
          where: { id: cycleId },
          select: {
            businessId: true,
            strategyId: true,
            strategyVersion: true,
            strategyDecisionId: true,
            profileVersionId: true,
          },
        });

        return tx.contentPack.create({
          data: {
            contentCycleId: cycleId,
            weeklyClaimId: randomUUID(),
            weekNumber,
            businessId: cycle.businessId,
            strategyId: cycle.strategyId,
            strategyVersion: cycle.strategyVersion,
            strategyDecisionId: cycle.strategyDecisionId,
            profileVersionId: cycle.profileVersionId,
            weekContextId,
            status: "queued",
            retryEligible: true,
            itemIds: [],
          },
        });
      });
      return { pack, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.contentPack.findUnique({
          where: {
            contentCycleId_weekNumber: {
              contentCycleId: cycleId,
              weekNumber,
            },
          },
        });
        if (existing) {
          return { pack: existing, created: false };
        }
      }
      throw error;
    }
  }

  async getPackByIdAndOwner(
    id: string,
    ownerUserId: string,
  ): Promise<ContentPack | null> {
    return this.prisma.contentPack.findFirst({
      where: {
        id,
        contentCycle: { ownerUserId },
      },
    });
  }

  async listPacks(cycleId: string): Promise<ContentPack[]> {
    return this.prisma.contentPack.findMany({
      where: { contentCycleId: cycleId },
      orderBy: { weekNumber: "asc" },
    });
  }

  async getProgressEvents(packId: string): Promise<PersistedContentProgressEvent[]> {
    return this.prisma.contentProgressEvent.findMany({
      where: { contentPackId: packId },
      orderBy: { seq: "asc" },
    });
  }

  async listItemVersions(
    packId: string,
    itemId: string,
  ): Promise<Prisma.ContentItemVersionGetPayload<Record<string, never>>[]> {
    return this.prisma.contentItemVersion.findMany({
      where: { contentPackId: packId, contentItemId: itemId },
      orderBy: { version: "desc" },
    });
  }

  /**
   * Appends an immutable sequenced progress event. Seq is the event count for
   * the pack at insert time + 1; `@@unique([content_pack_id, seq])` rejects a
   * duplicate seq so two concurrent appends cannot write the same sequence
   * number.
   */
  async appendProgressEvent(
    packId: string,
    event: ContentProgressInput,
  ): Promise<PersistedContentProgressEvent> {
    return this.prisma.$transaction(async (tx) => {
      const seq = await tx.contentProgressEvent.count({
        where: { contentPackId: packId },
      });

      return tx.contentProgressEvent.create({
        data: {
          contentPackId: packId,
          seq: seq + 1,
          stage: event.stage,
          status: event.status,
          messageKey: event.messageKey,
          messageText: event.messageText,
          payload: (event.payload ?? {}) as Prisma.InputJsonObject,
        },
      });
    });
  }

  /**
   * FSM-guarded status transition. The contract is validated in JS first (an
   * illegal transition throws), then the actual write is a conditional UPDATE
   * (WHERE status = from) so a concurrent caller that already moved the status
   * sees zero rows and the transition does not apply twice.
   */
  async markPackStatus(
    packId: string,
    from: ContentPackStatus,
    to: ContentPackStatus,
  ): Promise<{ changed: boolean }> {
    if (!canTransitionContentPack(from, to)) {
      throw new BadRequestException(
        `Invalid content pack transition: ${from} → ${to}`,
      );
    }

    const result = await this.prisma.contentPack.updateMany({
      where: { id: packId, status: from },
      data: { status: to },
    });

    return { changed: result.count === 1 };
  }
}

export type PersistedContentProgressEvent = {
  readonly id: bigint;
  readonly contentPackId: string;
  readonly seq: number;
  readonly stage: string;
  readonly status: string;
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload: Prisma.JsonValue;
  readonly createdAt: Date;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
