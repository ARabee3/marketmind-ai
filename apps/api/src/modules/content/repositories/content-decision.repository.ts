import {
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";

export type ContentDecisionValue = "approved" | "rejected" | "revision_requested";

export type RecordContentDecisionInput = {
  itemId: string;
  versionId: string;
  versionNumber: number;
  versionChecksum: string;
  decision: ContentDecisionValue;
  revisionNotes: string | null;
  ownerUserId: string;
  idempotencyKey: string;
};

export type BulkContentDecisionRequest = {
  itemId: string;
  versionId: string;
  versionChecksum: string;
  decision: ContentDecisionValue;
  revisionNotes: string | null;
  idempotencyKey: string;
};

export type ContentDecisionRow = {
  id: string;
  contentItemId: string;
  contentItemVersionId: string;
  contentItemVersion: number;
  contentItemVersionChecksum: string;
  decision: ContentDecisionValue;
  revisionNotes: string | null;
  decidedByUserId: string;
  decidedAt: Date;
  ownerUserId: string;
  idempotencyKey: string | null;
  createdAt: Date;
};

export type BulkDecisionError = {
  itemId: string;
  code: string;
  message: string;
};

export type BulkRecordDecisionsResult = {
  decisions: ContentDecisionRow[];
  errors: BulkDecisionError[];
};

const STATUS_FOR_DECISION: Record<ContentDecisionValue, string> = {
  approved: "approved",
  rejected: "rejected",
  revision_requested: "revision_requested",
};

const CONTENT_VERSION_CONFLICT = "CONTENT_VERSION_CONFLICT";
const CONTENT_APPROVAL_BLOCKED = "CONTENT_APPROVAL_BLOCKED";

function versionConflict(message: string): ConflictException {
  return new ConflictException({ code: CONTENT_VERSION_CONFLICT, message });
}

/**
 * Persists owner decisions against an exact immutable Content item version.
 *
 * Every decision references one exact version; the checksum and the item's
 * `current_version_id` are validated inside the transaction so a stale or
 * mutated version can never be decided. An approved/rejected/revisioned
 * version is terminal for Content v1: changing publishable copy requires a
 * new version and a new decision.
 */
export class ContentDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a single decision idempotently on `@@unique([owner_user_id, idempotency_key])`.
   * Repeated requests with the same idempotency key return the original decision.
   * Stale version (mismatched checksum or non-current version) throws
   * CONTENT_VERSION_CONFLICT before any row is written.
   */
  async recordDecision(
    input: RecordContentDecisionInput,
  ): Promise<ContentDecisionRow> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.contentDecision.findUnique({
        where: {
          ownerUserId_idempotencyKey: {
            ownerUserId: input.ownerUserId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        return existing as ContentDecisionRow;
      }

      const item = await tx.contentItem.findUnique({
        where: { id: input.itemId },
        select: { id: true, currentVersionId: true },
      });
      if (!item) {
        throw new NotFoundException("Content item not found");
      }

      const version = await tx.contentItemVersion.findUnique({
        where: { id: input.versionId },
        select: { id: true, version: true, versionChecksum: true },
      });
      if (!version) {
        throw new NotFoundException("Content item version not found");
      }

      if (item.currentVersionId !== input.versionId) {
        throw versionConflict(
          "This item version is no longer the current version. Refresh before deciding.",
        );
      }
      if (
        version.version !== input.versionNumber ||
        version.versionChecksum !== input.versionChecksum
      ) {
        throw versionConflict(
          "The submitted version checksum no longer matches the current item version.",
        );
      }

      let decision: ContentDecisionRow;
      try {
        decision = (await tx.contentDecision.create({
          data: {
            contentItemId: input.itemId,
            contentItemVersionId: input.versionId,
            contentItemVersion: version.version,
            contentItemVersionChecksum: version.versionChecksum,
            decision: input.decision,
            revisionNotes: input.revisionNotes,
            decidedByUserId: input.ownerUserId,
            decidedAt: new Date(),
            ownerUserId: input.ownerUserId,
            idempotencyKey: input.idempotencyKey,
          },
        })) as ContentDecisionRow;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const replayed = await tx.contentDecision.findUnique({
            where: {
              ownerUserId_idempotencyKey: {
                ownerUserId: input.ownerUserId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (replayed) {
            return replayed as ContentDecisionRow;
          }
        }
        throw error;
      }

      // Exact-version guard: only applies while the item still points at the
      // decided version. A concurrent move to a newer version yields zero
      // rows and rolls the decision back.
      const updated = await tx.contentItem.updateMany({
        where: { id: input.itemId, currentVersionId: input.versionId },
        data: {
          currentVersionId: input.versionId,
          status: STATUS_FOR_DECISION[input.decision],
        },
      });
      if (updated.count === 0) {
        throw versionConflict(
          "A concurrent change moved the item away from the submitted version; decision not applied.",
        );
      }

      return decision;
    });
  }

  /**
   * Validates every entry (item current version, version checksum, not already
   * decided) and writes the eligible decisions in ONE transaction. Ineligible
   * entries are reported per-item — they do not roll back the eligible ones.
   */
  async bulkRecordDecisions(
    requests: BulkContentDecisionRequest[],
    ownerUserId: string,
  ): Promise<BulkRecordDecisionsResult> {
    return this.prisma.$transaction(async (tx) => {
      const itemIds = [...new Set(requests.map((r) => r.itemId))];
      const versionIds = [...new Set(requests.map((r) => r.versionId))];
      const idempotencyKeys = [...new Set(requests.map((r) => r.idempotencyKey))];

      const [items, versions, decided, byKey] = await Promise.all([
        tx.contentItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, currentVersionId: true },
        }),
        tx.contentItemVersion.findMany({
          where: { id: { in: versionIds } },
          select: { id: true, version: true, versionChecksum: true },
        }),
        tx.contentDecision.findMany({
          where: { contentItemVersionId: { in: versionIds } },
          select: { contentItemVersionId: true },
        }),
        tx.contentDecision.findMany({
          where: {
            ownerUserId,
            idempotencyKey: { in: idempotencyKeys },
          },
        }),
      ]);

      const itemById = new Map(items.map((i) => [i.id, i]));
      const versionById = new Map(versions.map((v) => [v.id, v]));
      const decidedVersionIds = new Set(decided.map((d) => d.contentItemVersionId));
      const replayByKey = new Map(
        byKey
          .filter((d): d is ContentDecisionRow => d.idempotencyKey !== null)
          .map((d) => [d.idempotencyKey as string, d]),
      );

      const decisions: ContentDecisionRow[] = [];
      const errors: BulkDecisionError[] = [];

      for (const req of requests) {
        const replay = replayByKey.get(req.idempotencyKey);
        if (replay) {
          decisions.push(replay);
          continue;
        }

        const item = itemById.get(req.itemId);
        const version = versionById.get(req.versionId);

        if (!item || !version) {
          errors.push({
            itemId: req.itemId,
            code: CONTENT_VERSION_CONFLICT,
            message: "Content item or version not found.",
          });
          continue;
        }
        if (item.currentVersionId !== req.versionId) {
          errors.push({
            itemId: req.itemId,
            code: CONTENT_VERSION_CONFLICT,
            message: "This item version is no longer the current version.",
          });
          continue;
        }
        if (version.versionChecksum !== req.versionChecksum) {
          errors.push({
            itemId: req.itemId,
            code: CONTENT_VERSION_CONFLICT,
            message: "The submitted version checksum no longer matches the current item version.",
          });
          continue;
        }
        if (decidedVersionIds.has(req.versionId)) {
          errors.push({
            itemId: req.itemId,
            code: CONTENT_APPROVAL_BLOCKED,
            message: "This item version already has a decision.",
          });
          continue;
        }

        const decision = (await tx.contentDecision.create({
          data: {
            contentItemId: req.itemId,
            contentItemVersionId: req.versionId,
            contentItemVersion: version.version,
            contentItemVersionChecksum: version.versionChecksum,
            decision: req.decision,
            revisionNotes: req.revisionNotes,
            decidedByUserId: ownerUserId,
            decidedAt: new Date(),
            ownerUserId,
            idempotencyKey: req.idempotencyKey,
          },
        })) as ContentDecisionRow;
        decisions.push(decision);

        const updated = await tx.contentItem.updateMany({
          where: { id: req.itemId, currentVersionId: req.versionId },
          data: { status: STATUS_FOR_DECISION[req.decision] },
        });
        if (updated.count === 0) {
          throw versionConflict(
            "A concurrent change moved the item away from the submitted version; bulk decision not applied.",
          );
        }
      }

      return { decisions, errors };
    });
  }
}
