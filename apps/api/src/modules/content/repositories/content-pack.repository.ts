import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, ContentPack } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  canTransitionContentPack,
  ContentPackStatus,
} from "@marketmind/contracts";
import { weekCutoffDate } from "../content-schedule";

export type ContentItemVersionDraftInput = {
  readonly id: string;
  readonly contentItemId: string;
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
  readonly createdAt: Date;
};

export type AppendPackWithItemsInput = {
  readonly cycleId: string;
  readonly weekNumber: number;
  readonly weekContextId: string;
  readonly items: ContentItemVersionDraftInput[];
  readonly generationRunId: string;
};

export type GenerationJobIntentInput = {
  readonly idempotencyKey: string;
};

export type ContentAssetJobIntent = {
  readonly assetId: string;
  readonly contentItemVersionId: string;
  readonly creativeBrief: string;
  readonly altText: string;
  readonly width: number;
  readonly height: number;
};

export type PersistGeneratedItemsInput = {
  readonly packId: string;
  readonly cycleId: string;
  readonly weekNumber: number;
  readonly generationRunId: string;
  readonly items: ContentItemVersionDraftInput[];
  readonly progressEvent: ContentProgressInput;
  readonly providerName?: string;
  readonly providerModel?: string;
  readonly inputHash?: string;
  readonly latencyMs: number;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly assetJobs?: readonly ContentAssetJobIntent[];
};

export type AppendRevisedItemVersionInput = {
  readonly id: string;
  readonly packId: string;
  readonly itemId: string;
  readonly baseVersionId: string;
  readonly newVersionNumber: number;
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
  readonly createdAt: Date;
  readonly assetJob?: ContentAssetJobIntent;
};

export type CreateAssetInput = {
  readonly id?: string;
  readonly contentItemVersionId: string;
  readonly kind: string;
  readonly status: string;
  readonly mimeType: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly storageKey: string | null;
  readonly checksum: string | null;
  readonly altText: string;
  readonly providerName: string | null;
  readonly providerModel: string | null;
  readonly providerRequestId: string | null;
  readonly failureCode: string | null;
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

        const weekContext = await tx.contentWeekContext.findUniqueOrThrow({
          where: { id: input.weekContextId },
          select: { weeklyClaimId: true },
        });

        const pack = await tx.contentPack.create({
          data: {
            contentCycleId: input.cycleId,
            weeklyClaimId: weekContext.weeklyClaimId,
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
              id: draft.contentItemId,
              contentPackId: pack.id,
              status: "draft",
            },
          });
          itemIds.push(item.id);

          const version = await tx.contentItemVersion.create({
            data: {
              id: draft.id,
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
              createdAt: draft.createdAt,
            },
          });
          await linkVersionAssets(
            tx,
            version.id,
            draft.assetIds,
            draft.altText,
          );

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
    jobIntent?: GenerationJobIntentInput,
  ): Promise<{ pack: ContentPack; created: boolean }> {
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 12) {
      throw new BadRequestException("Content week must be between 1 and 12.");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize claims for one cycle before reading currentWeekNumber. The
        // unique pack key remains the final idempotency guard, but the row lock
        // also prevents a manual request from skipping a week under a race.
        await tx.$queryRaw`
          SELECT "id"
          FROM "content_cycles"
          WHERE "id" = ${cycleId}::uuid
          FOR UPDATE
        `;

        const existing = await tx.contentPack.findUnique({
          where: {
            contentCycleId_weekNumber: {
              contentCycleId: cycleId,
              weekNumber,
            },
          },
        });
        if (existing) return { pack: existing, created: false };

        const cycle = await tx.contentCycle.findUniqueOrThrow({
          where: { id: cycleId },
          select: {
            businessId: true,
            strategyId: true,
            strategyVersion: true,
            strategyDecisionId: true,
            profileVersionId: true,
            currentWeekNumber: true,
            status: true,
            week1StartDate: true,
          },
        });

        if (cycle.status !== "active") {
          throw new BadRequestException(
            `Content cycle ${cycleId} is not active; cannot claim week ${weekNumber}.`,
          );
        }
        if (
          !(
            (weekNumber === 1 && cycle.currentWeekNumber === 1) ||
            weekNumber === cycle.currentWeekNumber + 1
          )
        ) {
          throw new BadRequestException(
            `Week ${weekNumber} is not the exact next eligible week for cycle ${cycleId}.`,
          );
        }

        if (weekNumber > 1) {
          const previousPack = await tx.contentPack.findUnique({
            where: {
              contentCycleId_weekNumber: {
                contentCycleId: cycleId,
                weekNumber: weekNumber - 1,
              },
            },
            select: { status: true },
          });
          if (!previousPack || !isCompletedPackStatus(previousPack.status)) {
            throw new BadRequestException(
              `Week ${weekNumber - 1} is not complete; cannot claim week ${weekNumber}.`,
            );
          }
        }

        const weekContext = await tx.contentWeekContext.findUniqueOrThrow({
          where: { id: weekContextId },
          select: {
            weeklyClaimId: true,
            contentCycleId: true,
            weekNumber: true,
            frozenAt: true,
          },
        });
        if (
          weekContext.contentCycleId !== cycleId ||
          weekContext.weekNumber !== weekNumber
        ) {
          throw new BadRequestException(
            `Week context ${weekContextId} does not belong to cycle ${cycleId} week ${weekNumber}.`,
          );
        }

        const frozen = await tx.contentWeekContext.updateMany({
          where: {
            id: weekContextId,
            contentCycleId: cycleId,
            weekNumber,
            frozenAt: null,
          },
          data: { frozenAt: new Date() },
        });
        if (frozen.count === 0 || weekContext.frozenAt !== null) {
          throw new BadRequestException(
            `Week ${weekNumber} context is already frozen or unavailable.`,
          );
        }

        const createdPack = await tx.contentPack.create({
          data: {
            contentCycleId: cycleId,
            weeklyClaimId: weekContext.weeklyClaimId,
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

        if (jobIntent) {
          await tx.contentJobOutbox.create({
            data: {
              jobId: `generate-content:${createdPack.id}`,
              queueName: "content-generation",
              jobName: "generate-content",
              payload: {
                contentCycleId: cycleId,
                weekNumber,
                contentPackId: createdPack.id,
                idempotencyKey: `pack:${createdPack.id}`,
                correlationId: `pack:${createdPack.id}`,
              },
            },
          });
        }

        await tx.contentCycle.update({
          where: { id: cycleId },
          data: {
            currentWeekNumber: weekNumber,
            nextGenerationAt: weekCutoffDate(cycle.week1StartDate, weekNumber),
          },
        });

        return { pack: createdPack, created: true };
      });
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

  /**
   * Content v2 claim (issue #187): serializes on the cycle row, freezes the
   * week plan with its transactionally frozen plan/profile/CTA/media
   * snapshot, freezes the week context, and creates the queued v2 pack plus
   * its durable `generate-content-v2` job intent. Eligibility for v2 is the
   * current actionable week only; the unique pack key stays the idempotency
   * guard.
   */
  async claimQueuedPackV2(input: {
    readonly cycleId: string;
    readonly weekNumber: number;
    readonly weekContextId: string;
    readonly weekPlanId: string;
    readonly frozenInput: unknown;
    readonly jobIntent?: GenerationJobIntentInput;
  }): Promise<{ pack: ContentPack; created: boolean }> {
    const { cycleId, weekNumber, weekContextId, weekPlanId, frozenInput } =
      input;
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 12) {
      throw new BadRequestException("Content week must be between 1 and 12.");
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "content_cycles"
          WHERE "id" = ${cycleId}::uuid
          FOR UPDATE
        `;

        const existing = await tx.contentPack.findUnique({
          where: {
            contentCycleId_weekNumber: { contentCycleId: cycleId, weekNumber },
          },
        });
        if (existing) return { pack: existing, created: false };

        const cycle = await tx.contentCycle.findUniqueOrThrow({
          where: { id: cycleId },
          select: {
            businessId: true,
            strategyId: true,
            strategyVersion: true,
            strategyDecisionId: true,
            profileVersionId: true,
            currentWeekNumber: true,
            status: true,
            week1StartDate: true,
          },
        });
        if (cycle.status !== "active") {
          throw new BadRequestException(
            `Content cycle ${cycleId} is not active; cannot claim week ${weekNumber}.`,
          );
        }
        if (weekNumber !== cycle.currentWeekNumber) {
          throw new BadRequestException(
            `Week ${weekNumber} is not the current actionable week for cycle ${cycleId}.`,
          );
        }

        const weekContext = await tx.contentWeekContext.findUniqueOrThrow({
          where: { id: weekContextId },
          select: {
            weeklyClaimId: true,
            contentCycleId: true,
            weekNumber: true,
            frozenAt: true,
          },
        });
        if (
          weekContext.contentCycleId !== cycleId ||
          weekContext.weekNumber !== weekNumber
        ) {
          throw new BadRequestException(
            `Week context ${weekContextId} does not belong to cycle ${cycleId} week ${weekNumber}.`,
          );
        }

        const frozenPlan = await tx.contentWeekPlan.updateMany({
          where: {
            id: weekPlanId,
            contentCycleId: cycleId,
            weekNumber,
            status: "draft",
          },
          data: {
            status: "frozen",
            frozenInput: frozenInput as Prisma.InputJsonValue,
          },
        });
        if (frozenPlan.count === 0) {
          throw new BadRequestException(
            `Week ${weekNumber} plan is already frozen or missing; cannot claim.`,
          );
        }

        const frozen = await tx.contentWeekContext.updateMany({
          where: {
            id: weekContextId,
            contentCycleId: cycleId,
            weekNumber,
            frozenAt: null,
          },
          data: { frozenAt: new Date() },
        });
        if (frozen.count === 0 || weekContext.frozenAt !== null) {
          throw new BadRequestException(
            `Week ${weekNumber} context is already frozen or unavailable.`,
          );
        }

        const createdPack = await tx.contentPack.create({
          data: {
            contentCycleId: cycleId,
            weeklyClaimId: weekContext.weeklyClaimId,
            weekNumber,
            businessId: cycle.businessId,
            strategyId: cycle.strategyId,
            strategyVersion: cycle.strategyVersion,
            strategyDecisionId: cycle.strategyDecisionId,
            profileVersionId: cycle.profileVersionId,
            weekContextId,
            contractVersion: "content-v2",
            weekPlanId,
            status: "queued",
            retryEligible: true,
            itemIds: [],
          },
        });

        if (input.jobIntent) {
          await tx.contentJobOutbox.create({
            data: {
              jobId: `generate-content-v2:${createdPack.id}`,
              queueName: "content-generation",
              jobName: "generate-content-v2",
              payload: {
                contentCycleId: cycleId,
                weekNumber,
                contentPackId: createdPack.id,
                idempotencyKey: `pack:${createdPack.id}`,
                correlationId: `pack:${createdPack.id}`,
              },
            },
          });
        }

        await tx.contentCycle.update({
          where: { id: cycleId },
          data: {
            nextGenerationAt: weekCutoffDate(cycle.week1StartDate, weekNumber),
          },
        });

        return { pack: createdPack, created: true };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.contentPack.findUnique({
          where: {
            contentCycleId_weekNumber: { contentCycleId: cycleId, weekNumber },
          },
        });
        if (existing) {
          return { pack: existing, created: false };
        }
      }
      throw error;
    }
  }

  /**
   * Unscoped read for the processor — returns the pack with its items and
   * their current version. Ownership is not checked; the caller (processor)
   * guards against cross-business access via its own short-circuit checks.
   */
  async getPackById(id: string): Promise<ContentPack | null> {
    return this.prisma.contentPack.findUnique({ where: { id } });
  }

  async hasPackForWeek(cycleId: string, weekNumber: number): Promise<boolean> {
    const count = await this.prisma.contentPack.count({
      where: { contentCycleId: cycleId, weekNumber },
    });
    return count > 0;
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

  async getProgressEvents(
    packId: string,
  ): Promise<PersistedContentProgressEvent[]> {
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
   * Reads a single content item scoped to a pack. The pack ownership check is
   * the caller's job (`getPackByIdAndOwner`); the packId scoping here keeps a
   * caller that already holds a verified pack from leaking rows across packs.
   */
  async getItemById(
    packId: string,
    itemId: string,
  ): Promise<Prisma.ContentItemGetPayload<Record<string, never>> | null> {
    return this.prisma.contentItem.findFirst({
      where: { id: itemId, contentPackId: packId },
    });
  }

  /**
   * Lists the asset rows attached to one immutable content item version.
   * Decision-time asset readiness checks read from here; rows are insert-only
   * and never mutated, so the list is stable for a given version.
   */
  async listAssetsForVersion(
    versionId: string,
  ): Promise<Prisma.ContentAssetGetPayload<Record<string, never>>[]> {
    const assets = await this.prisma.contentAsset.findMany({
      where: {
        OR: [
          { contentItemVersionId: versionId },
          { versionLinks: { some: { contentItemVersionId: versionId } } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    // The relation, not the legacy nullable owner column, is authoritative for
    // a reused asset. Project the requested immutable version identity into
    // the frozen contract without mutating the original asset row.
    return assets.map((asset) => ({
      ...asset,
      contentItemVersionId: versionId,
    }));
  }

  /**
   * Reads a single content asset scoped to the owning user.
   *
   * Ownership is verified by walking the relation chain
   * asset → item version → pack → cycle → ownerUserId, so a cross-owner
   * asset id returns null (404 upstream) instead of leaking another owner's
   * asset existence.
   */
  async getAssetByIdAndOwner(
    assetId: string,
    ownerUserId: string,
  ): Promise<Prisma.ContentAssetGetPayload<Record<string, never>> | null> {
    return this.prisma.contentAsset.findFirst({
      where: {
        id: assetId,
        OR: [
          {
            contentItemVersion: {
              contentPack: {
                contentCycle: { ownerUserId },
              },
            },
          },
          {
            versionLinks: {
              some: {
                contentItemVersion: {
                  contentPack: { contentCycle: { ownerUserId } },
                },
              },
            },
          },
        ],
      },
    });
  }

  async getAssetById(
    assetId: string,
  ): Promise<Prisma.ContentAssetGetPayload<Record<string, never>> | null> {
    return this.prisma.contentAsset.findUnique({ where: { id: assetId } });
  }

  /**
   * Loads reusable, publication-capable assets for the exact business owner.
   *
   * A week context contains only asset IDs, so generation must resolve those
   * IDs against the authoritative ownership graph before putting them in the
   * provider-policy fixture. The version-link branch preserves approved asset
   * reuse without changing the original asset row's owning version.
   */
  async listReusableAssets(
    assetIds: readonly string[],
    businessId: string,
    ownerUserId: string,
  ): Promise<Prisma.ContentAssetGetPayload<Record<string, never>>[]> {
    const ids = [...new Set(assetIds)];
    if (ids.length === 0) return [];

    return this.prisma.contentAsset.findMany({
      where: {
        id: { in: ids },
        status: "ready",
        kind: { in: ["owner_supplied", "generated_static"] },
        OR: [
          {
            contentItemVersion: {
              contentPack: {
                businessId,
                contentCycle: { ownerUserId },
              },
            },
          },
          {
            versionLinks: {
              some: {
                contentItemVersion: {
                  contentPack: {
                    businessId,
                    contentCycle: { ownerUserId },
                  },
                },
              },
            },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Resolves only the ownership context needed by billing at the worker
   * boundary. Asset bytes and provider payloads are deliberately not loaded.
   */
  async getAssetBillingContext(assetId: string): Promise<{
    ownerUserId: string;
    businessId: string;
  } | null> {
    const asset = await this.prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: {
        contentItemVersion: {
          select: {
            contentPack: {
              select: {
                businessId: true,
                contentCycle: { select: { ownerUserId: true } },
              },
            },
          },
        },
        versionLinks: {
          take: 1,
          select: {
            contentItemVersion: {
              select: {
                contentPack: {
                  select: {
                    businessId: true,
                    contentCycle: { select: { ownerUserId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const context =
      asset?.contentItemVersion?.contentPack ??
      asset?.versionLinks[0]?.contentItemVersion.contentPack;
    if (!context) return null;
    return {
      ownerUserId: context.contentCycle.ownerUserId,
      businessId: context.businessId,
    };
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
    tx?: Prisma.TransactionClient,
  ): Promise<{ changed: boolean }> {
    if (!canTransitionContentPack(from, to)) {
      throw new BadRequestException(
        `Invalid content pack transition: ${from} → ${to}`,
      );
    }

    const db = tx ?? this.prisma;
    const result = await db.contentPack.updateMany({
      where: { id: packId, status: from },
      data: { status: to },
    });

    return { changed: result.count === 1 };
  }

  /** Claims a queued pack or a retryable failed pack for another provider attempt. */
  async claimPackForGeneration(packId: string): Promise<{ changed: boolean }> {
    const result = await this.prisma.contentPack.updateMany({
      where: {
        id: packId,
        status: { in: ["queued", "failed"] },
        retryEligible: true,
      },
      data: { status: "generating" },
    });
    return { changed: result.count === 1 };
  }

  /**
   * Re-derives pack status from every item's current status after owner
   * decisions. All items approved -> "approved"; some approved ->
   * "partially_approved"; none approved -> "draft".
   */
  async derivePackStatusFromItems(
    packId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const items = await db.contentItem.findMany({
      where: { contentPackId: packId },
      select: { status: true },
    });
    if (items.length === 0) return;

    const allApproved = items.every((item) => item.status === "approved");
    const anyApproved = items.some((item) => item.status === "approved");

    const targetStatus: ContentPackStatus = allApproved
      ? "approved"
      : anyApproved
        ? "partially_approved"
        : "draft";

    const pack = await db.contentPack.findUnique({
      where: { id: packId },
      select: { status: true },
    });
    if (!pack || pack.status === "failed") return;
    if (pack.status === targetStatus) return;
    if (
      !canTransitionContentPack(pack.status as ContentPackStatus, targetStatus)
    )
      return;

    await db.contentPack.updateMany({
      where: { id: packId, status: pack.status },
      data: { status: targetStatus },
    });
  }

  async persistGeneratedItems(
    input: PersistGeneratedItemsInput,
  ): Promise<ContentPack> {
    return this.prisma.$transaction(async (tx) => {
      const pack = await tx.contentPack.findUniqueOrThrow({
        where: { id: input.packId },
      });

      if (
        pack.contentCycleId !== input.cycleId ||
        pack.weekNumber !== input.weekNumber
      ) {
        throw new BadRequestException(
          `Pack ${input.packId} does not match the claimed cycle/week.`,
        );
      }

      if (pack.status !== "validating") {
        throw new BadRequestException(
          `Cannot persist items: pack ${input.packId} is in status ${pack.status}, expected validating`,
        );
      }

      const itemIds: string[] = [];
      for (const draft of input.items) {
        const item = await tx.contentItem.create({
          data: {
            id: draft.contentItemId,
            contentPackId: input.packId,
            status: "draft",
          },
        });
        itemIds.push(item.id);

        const version = await tx.contentItemVersion.create({
          data: {
            id: draft.id,
            contentItemId: item.id,
            contentPackId: input.packId,
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
            createdAt: draft.createdAt,
          },
        });
        await linkVersionAssets(tx, version.id, draft.assetIds, draft.altText);

        await tx.contentItem.update({
          where: { id: item.id },
          data: { currentVersionId: version.id },
        });
      }

      const updated = await tx.contentPack.updateMany({
        where: { id: input.packId, status: "validating" },
        data: { itemIds, status: "draft" },
      });

      if (updated.count === 0) {
        throw new BadRequestException(
          `Pack ${input.packId} is no longer in validating status`,
        );
      }

      for (const assetJob of input.assetJobs ?? []) {
        await createAssetJobIntent(tx, assetJob);
      }

      if (input.weekNumber === 12) {
        await tx.contentCycle.updateMany({
          where: {
            id: input.cycleId,
            status: "active",
            currentWeekNumber: 12,
          },
          data: { status: "completed", completedAt: new Date() },
        });
      }

      await tx.contentGenerationRun.create({
        data: {
          id: input.generationRunId,
          contentPackId: input.packId,
          contentCycleId: input.cycleId,
          weekNumber: input.weekNumber,
          runType: "generate",
          status: "completed",
          providerName: input.providerName,
          providerModel: input.providerModel,
          inputHash: input.inputHash,
          latencyMs: input.latencyMs,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
        },
      });

      const seq = await tx.contentProgressEvent.count({
        where: { contentPackId: input.packId },
      });
      await tx.contentProgressEvent.create({
        data: {
          contentPackId: input.packId,
          seq: seq + 1,
          stage: input.progressEvent.stage,
          status: input.progressEvent.status,
          messageKey: input.progressEvent.messageKey,
          messageText: input.progressEvent.messageText,
          payload: (input.progressEvent.payload ??
            {}) as Prisma.InputJsonObject,
        },
      });

      return tx.contentPack.findUniqueOrThrow({
        where: { id: input.packId },
      });
    });
  }

  /**
   * Content v2 persistence (issue #187): identical to
   * `persistGeneratedItems` plus the v2 contract tag, the frozen-plan link,
   * and immutable generated edit metadata on every version row.
   */
  async persistGeneratedItemsV2(
    input: PersistGeneratedItemsInput,
  ): Promise<ContentPack> {
    return this.prisma.$transaction(async (tx) => {
      const pack = await tx.contentPack.findUniqueOrThrow({
        where: { id: input.packId },
      });

      if (
        pack.contentCycleId !== input.cycleId ||
        pack.weekNumber !== input.weekNumber
      ) {
        throw new BadRequestException(
          `Pack ${input.packId} does not match the claimed cycle/week.`,
        );
      }
      if (pack.status !== "validating") {
        throw new BadRequestException(
          `Cannot persist items: pack ${input.packId} is in status ${pack.status}, expected validating`,
        );
      }

      const itemIds: string[] = [];
      for (const draft of input.items) {
        const item = await tx.contentItem.create({
          data: {
            id: draft.contentItemId,
            contentPackId: input.packId,
            status: "draft",
          },
        });
        itemIds.push(item.id);

        const version = await tx.contentItemVersion.create({
          data: {
            id: draft.id,
            contentItemId: item.id,
            contentPackId: input.packId,
            contractVersion: "content-v2",
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
            editKind: "generated",
            baseVersionId: null,
            baseVersionChecksum: null,
            editedByUserId: null,
            validationState: "validated",
            editedAt: draft.createdAt,
            createdAt: draft.createdAt,
          },
        });
        await linkVersionAssets(tx, version.id, draft.assetIds, draft.altText);

        await tx.contentItem.update({
          where: { id: item.id },
          data: { currentVersionId: version.id },
        });
      }

      const updated = await tx.contentPack.updateMany({
        where: { id: input.packId, status: "validating" },
        data: { itemIds, status: "draft" },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          `Pack ${input.packId} is no longer in validating status`,
        );
      }

      if (input.weekNumber === 12) {
        await tx.contentCycle.updateMany({
          where: {
            id: input.cycleId,
            status: "active",
            currentWeekNumber: 12,
          },
          data: { status: "completed", completedAt: new Date() },
        });
      }

      await tx.contentGenerationRun.create({
        data: {
          id: input.generationRunId,
          contentPackId: input.packId,
          contentCycleId: input.cycleId,
          weekNumber: input.weekNumber,
          runType: "generate",
          status: "completed",
          providerName: input.providerName,
          providerModel: input.providerModel,
          inputHash: input.inputHash,
          latencyMs: input.latencyMs,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
        },
      });

      const seq = await tx.contentProgressEvent.count({
        where: { contentPackId: input.packId },
      });
      await tx.contentProgressEvent.create({
        data: {
          contentPackId: input.packId,
          seq: seq + 1,
          stage: input.progressEvent.stage,
          status: input.progressEvent.status,
          messageKey: input.progressEvent.messageKey,
          messageText: input.progressEvent.messageText,
          payload: (input.progressEvent.payload ??
            {}) as Prisma.InputJsonObject,
        },
      });

      return tx.contentPack.findUniqueOrThrow({
        where: { id: input.packId },
      });
    });
  }

  async safeFail(
    packId: string,
    messageKey: string,
    messageText: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const retryEligible = payload?.retryable === true;
    await this.prisma.$transaction(async (tx) => {
      await tx.contentPack.update({
        where: { id: packId },
        data: { status: "failed", retryEligible },
      });

      const seq = await tx.contentProgressEvent.count({
        where: { contentPackId: packId },
      });
      await tx.contentProgressEvent.create({
        data: {
          contentPackId: packId,
          seq: seq + 1,
          stage: "failed",
          status: "failed",
          messageKey,
          messageText,
          payload: (payload ?? {}) as Prisma.InputJsonObject,
        },
      });
    });
  }

  async appendRevisedItemVersion(
    input: AppendRevisedItemVersionInput,
  ): Promise<Prisma.ContentItemVersionGetPayload<Record<string, never>>> {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentItem.findFirst({
        where: {
          id: input.itemId,
          contentPackId: input.packId,
          currentVersionId: input.baseVersionId,
        },
      });

      if (!item) {
        throw new BadRequestException(
          `Item ${input.itemId} is not at version ${input.baseVersionId}`,
        );
      }

      const newVersion = await tx.contentItemVersion.create({
        data: {
          id: input.id,
          contentItemId: input.itemId,
          contentPackId: input.packId,
          version: input.newVersionNumber,
          channel: input.channel,
          format: input.format,
          languageMode: input.languageMode,
          strategyTrace: input.strategyTrace,
          captionVariants: input.captionVariants,
          cta: input.cta,
          hashtags: input.hashtags,
          creativeBrief: input.creativeBrief,
          altText: input.altText,
          shortVideoScript: input.shortVideoScript,
          recommendedPublishWindow: input.recommendedPublishWindow,
          claimSources: input.claimSources,
          warnings: input.warnings,
          blockers: input.blockers,
          assetRequired: input.assetRequired,
          assetIds: input.assetIds,
          generationProvenance: input.generationProvenance,
          versionChecksum: input.versionChecksum,
          createdAt: input.createdAt,
        },
      });
      await linkVersionAssets(tx, newVersion.id, input.assetIds, input.altText);
      if (input.assetJob) {
        await createAssetJobIntent(tx, input.assetJob);
      }

      await tx.contentItem.update({
        where: { id: input.itemId },
        data: {
          currentVersionId: newVersion.id,
          status: "draft",
        },
      });

      return newVersion;
    });
  }

  async markItemStatus(
    itemId: string,
    status: string,
  ): Promise<{ changed: boolean }> {
    const result = await this.prisma.contentItem.updateMany({
      where: { id: itemId },
      data: { status },
    });
    return { changed: result.count === 1 };
  }

  async createAsset(
    input: CreateAssetInput,
  ): Promise<Prisma.ContentAssetGetPayload<Record<string, never>>> {
    const assetId = input.id ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.contentAsset.findUnique({
        where: { id: assetId },
      });
      const asset = existing
        ? existing
        : await tx.contentAsset.create({
            data: {
              id: assetId,
              contentItemVersionId: input.contentItemVersionId,
              kind: input.kind,
              status: input.status,
              mimeType: input.mimeType,
              width: input.width,
              height: input.height,
              storageKey: input.storageKey,
              checksum: input.checksum,
              altText: input.altText,
              providerName: input.providerName,
              providerModel: input.providerModel,
              providerRequestId: input.providerRequestId,
              failureCode: input.failureCode,
            },
          });

      await tx.contentItemVersionAsset.upsert({
        where: {
          contentItemVersionId_assetId: {
            contentItemVersionId: input.contentItemVersionId,
            assetId,
          },
        },
        create: {
          contentItemVersionId: input.contentItemVersionId,
          assetId,
        },
        update: {},
      });
      return asset;
    });
  }

  async markAssetReady(input: {
    readonly assetId: string;
    readonly contentItemVersionId: string;
    readonly mimeType: string;
    readonly width: number;
    readonly height: number;
    readonly storageKey: string;
    readonly checksum: string;
    readonly providerName: string | null;
    readonly providerModel: string | null;
    readonly providerRequestId: string | null;
  }): Promise<{ changed: boolean }> {
    const result = await this.prisma.contentAsset.updateMany({
      where: {
        id: input.assetId,
        contentItemVersionId: input.contentItemVersionId,
        status: { in: ["generating", "failed", "missing"] },
      },
      data: {
        status: "ready",
        mimeType: input.mimeType,
        width: input.width,
        height: input.height,
        storageKey: input.storageKey,
        checksum: input.checksum,
        providerName: input.providerName,
        providerModel: input.providerModel,
        providerRequestId: input.providerRequestId,
        failureCode: null,
      },
    });
    return { changed: result.count === 1 };
  }

  async markAssetFailed(input: {
    readonly assetId: string;
    readonly contentItemVersionId: string;
    readonly failureCode: string;
  }): Promise<{ changed: boolean }> {
    const result = await this.prisma.contentAsset.updateMany({
      where: {
        id: input.assetId,
        contentItemVersionId: input.contentItemVersionId,
        status: { not: "ready" },
      },
      data: {
        status: "failed",
        storageKey: null,
        checksum: null,
        failureCode: input.failureCode,
      },
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

function isCompletedPackStatus(status: string): boolean {
  return ["draft", "partially_approved", "approved"].includes(status);
}

async function linkVersionAssets(
  tx: Prisma.TransactionClient,
  contentItemVersionId: string,
  assetIdsValue: Prisma.InputJsonValue,
  altText: string,
): Promise<void> {
  const assetIds = Array.isArray(assetIdsValue)
    ? assetIdsValue.filter(
        (assetId): assetId is string => typeof assetId === "string",
      )
    : [];
  for (const assetId of assetIds) {
    const existing = await tx.contentAsset.findUnique({
      where: { id: assetId },
    });
    if (!existing) {
      await tx.contentAsset.create({
        data: {
          id: assetId,
          contentItemVersionId,
          kind: "generated_static",
          status: "generating",
          mimeType: null,
          width: null,
          height: null,
          storageKey: null,
          checksum: null,
          altText,
          providerName: null,
          providerModel: null,
          providerRequestId: null,
          failureCode: null,
        },
      });
    }
    await tx.contentItemVersionAsset.upsert({
      where: {
        contentItemVersionId_assetId: { contentItemVersionId, assetId },
      },
      create: { contentItemVersionId, assetId },
      update: {},
    });
  }
}

async function createAssetJobIntent(
  tx: Prisma.TransactionClient,
  job: ContentAssetJobIntent,
): Promise<void> {
  await tx.contentJobOutbox.create({
    data: {
      jobId: `generate-static-asset:${job.assetId}`,
      queueName: "content-generation",
      jobName: "generate-static-asset",
      payload: {
        assetId: job.assetId,
        contentItemVersionId: job.contentItemVersionId,
        creativeBrief: job.creativeBrief,
        altText: job.altText,
        width: job.width,
        height: job.height,
        idempotencyKey: `asset:${job.assetId}`,
        correlationId: `asset:${job.assetId}`,
      },
    },
  });
}
