import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../common/persistence/prisma.service";
import type {
  ContentCaptionVariant,
  ContentClaimSource,
} from "@marketmind/contracts";

export type OwnerDirectEditInput = {
  readonly contentItemId: string;
  readonly contentPackId: string;
  readonly baseVersionId: string;
  readonly baseVersionChecksum: string;
  readonly editedByUserId: string;
  readonly newVersionNumber: number;
  readonly channel: string;
  readonly format: string;
  readonly languageMode: string;
  readonly strategyTrace: Prisma.InputJsonValue;
  readonly captionVariants: readonly ContentCaptionVariant[];
  readonly cta: string | null;
  readonly hashtags: readonly string[];
  readonly creativeBrief: string;
  readonly altText: string;
  readonly shortVideoScript: Prisma.InputJsonValue | null;
  readonly recommendedPublishWindow: Prisma.InputJsonValue;
  readonly claimSources: readonly ContentClaimSource[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly assetRequired: boolean;
  readonly assetIds: readonly string[];
  readonly versionChecksum: string;
  readonly generationProvenance?: Prisma.InputJsonValue;
};

/**
 * Owner direct-edit persistence (issue #187).
 *
 * A new immutable validated version is created only when the base version id
 * AND its checksum match the item's current version. Stale bases fail with
 * `CONTENT_VERSION_CONFLICT`; no row is ever overwritten in place.
 */
@Injectable()
export class ContentVersionEditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async appendOwnerEditVersion(
    input: OwnerDirectEditInput,
  ): Promise<Prisma.ContentItemVersionGetPayload<Record<string, never>>> {
    const editedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentItem.findFirst({
        where: {
          id: input.contentItemId,
          contentPackId: input.contentPackId,
          currentVersionId: input.baseVersionId,
        },
        select: { id: true },
      });
      if (!item) {
        throw new ConflictException({
          code: "CONTENT_VERSION_CONFLICT",
          message:
            "The base version is no longer the current version. Refresh and retry.",
        });
      }
      const baseVersion = await tx.contentItemVersion.findUniqueOrThrow({
        where: { id: input.baseVersionId },
        select: { versionChecksum: true, version: true },
      });
      if (baseVersion.versionChecksum !== input.baseVersionChecksum) {
        throw new ConflictException({
          code: "CONTENT_VERSION_CONFLICT",
          message:
            "The base version checksum does not match. Refresh and retry.",
        });
      }
      if (input.newVersionNumber !== baseVersion.version + 1) {
        throw new BadRequestException({
          code: "CONTENT_VERSION_CONFLICT",
          message: `Edit must target version ${baseVersion.version + 1}, got ${input.newVersionNumber}.`,
        });
      }
      const versionId = randomUUID();
      const version = await tx.contentItemVersion.create({
        data: {
          id: versionId,
          contractVersion: "content-v2",
          contentItemId: input.contentItemId,
          contentPackId: input.contentPackId,
          version: input.newVersionNumber,
          channel: input.channel,
          format: input.format,
          languageMode: input.languageMode,
          strategyTrace: input.strategyTrace,
          captionVariants:
            input.captionVariants as unknown as Prisma.InputJsonValue,
          cta: input.cta,
          hashtags: input.hashtags as unknown as Prisma.InputJsonValue,
          creativeBrief: input.creativeBrief,
          altText: input.altText,
          shortVideoScript: input.shortVideoScript,
          recommendedPublishWindow: input.recommendedPublishWindow,
          claimSources: input.claimSources as unknown as Prisma.InputJsonValue,
          warnings: input.warnings as unknown as Prisma.InputJsonValue,
          blockers: input.blockers as unknown as Prisma.InputJsonValue,
          assetRequired: input.assetRequired,
          assetIds: input.assetIds as unknown as Prisma.InputJsonValue,
          generationProvenance: {
            generation_run_id: null,
            provider_name: "owner_direct_edit",
            provider_model: null,
            generated_at: editedAt.toISOString(),
          } as Prisma.InputJsonValue,
          versionChecksum: input.versionChecksum,
          editKind: "owner_direct_edit",
          baseVersionId: input.baseVersionId,
          baseVersionChecksum: input.baseVersionChecksum,
          editedByUserId: input.editedByUserId,
          validationState: "validated",
          editedAt,
          createdAt: editedAt,
        },
      });
      await tx.contentItem.update({
        where: { id: input.contentItemId },
        data: { currentVersionId: versionId, status: "draft" },
      });
      return version;
    });
  }

  /** Returns the latest immutable version of an owned item. */ async getCurrentVersion(
    contentItemId: string,
    ownerUserId: string,
  ): Promise<Prisma.ContentItemVersionGetPayload<
    Record<string, never>
  > | null> {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentItem.findUnique({
        where: { id: contentItemId },
        select: {
          id: true,
          currentVersionId: true,
          contentPack: {
            select: { contentCycle: { select: { ownerUserId: true } } },
          },
        },
      });
      if (!item || item.contentPack.contentCycle.ownerUserId !== ownerUserId) {
        throw new NotFoundException("Content item not found");
      }
      if (!item.currentVersionId) {
        return null;
      }
      return tx.contentItemVersion.findUnique({
        where: { id: item.currentVersionId },
      });
    });
  }

  /**
   * AI rewrite (issue #187): persists an immutable `ai_rewrite` version
   * gated on the same base id + checksum as owner edits. The AI service
   * already validated the rewritten content; this write only records it.
   */
  async appendAiRewriteVersion(
    input: OwnerDirectEditInput,
  ): Promise<Prisma.ContentItemVersionGetPayload<Record<string, never>>> {
    const editedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.contentItem.findFirst({
        where: {
          id: input.contentItemId,
          contentPackId: input.contentPackId,
          currentVersionId: input.baseVersionId,
        },
        select: { id: true },
      });
      if (!item) {
        throw new ConflictException({
          code: "CONTENT_VERSION_CONFLICT",
          message:
            "The base version is no longer the current version. Refresh and retry.",
        });
      }
      const baseVersion = await tx.contentItemVersion.findUniqueOrThrow({
        where: { id: input.baseVersionId },
        select: { versionChecksum: true, version: true },
      });
      if (baseVersion.versionChecksum !== input.baseVersionChecksum) {
        throw new ConflictException({
          code: "CONTENT_VERSION_CONFLICT",
          message:
            "The base version checksum does not match. Refresh and retry.",
        });
      }
      if (input.newVersionNumber !== baseVersion.version + 1) {
        throw new BadRequestException({
          code: "CONTENT_VERSION_CONFLICT",
          message: `Rewrite must target version ${baseVersion.version + 1}, got ${input.newVersionNumber}.`,
        });
      }
      const versionId = randomUUID();
      const version = await tx.contentItemVersion.create({
        data: {
          id: versionId,
          contractVersion: "content-v2",
          contentItemId: input.contentItemId,
          contentPackId: input.contentPackId,
          version: input.newVersionNumber,
          channel: input.channel,
          format: input.format,
          languageMode: input.languageMode,
          strategyTrace: input.strategyTrace,
          captionVariants:
            input.captionVariants as unknown as Prisma.InputJsonValue,
          cta: input.cta,
          hashtags: input.hashtags as unknown as Prisma.InputJsonValue,
          creativeBrief: input.creativeBrief,
          altText: input.altText,
          shortVideoScript: input.shortVideoScript,
          recommendedPublishWindow: input.recommendedPublishWindow,
          claimSources: input.claimSources as unknown as Prisma.InputJsonValue,
          warnings: input.warnings as unknown as Prisma.InputJsonValue,
          blockers: input.blockers as unknown as Prisma.InputJsonValue,
          assetRequired: input.assetRequired,
          assetIds: input.assetIds as unknown as Prisma.InputJsonValue,
          generationProvenance: input.generationProvenance,
          versionChecksum: input.versionChecksum,
          editKind: "ai_rewrite",
          baseVersionId: input.baseVersionId,
          baseVersionChecksum: input.baseVersionChecksum,
          editedByUserId: null,
          validationState: "validated",
          editedAt,
          createdAt: editedAt,
        },
      });
      await tx.contentItem.update({
        where: { id: input.contentItemId },
        data: { currentVersionId: versionId, status: "draft" },
      });
      return version;
    });
  }
}
