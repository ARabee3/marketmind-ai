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
import {
  computeContentItemVersionChecksum,
  deterministicGeneratedAssetId,
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
  readonly editKind?: "owner_direct_edit" | "ai_rewrite" | "media_update";
  readonly versionId?: string;
};

/**
 * Checksums are frozen from the exact bytes that this repository persists.
 *
 * Content v2 deliberately keeps the v1 item-version checksum surface so the
 * publication boundary remains compatible with existing validators. The
 * edit metadata is persisted separately and is not part of the item payload
 * hash. In particular, never trust a browser or provider checksum here: the
 * server allocates the version id and created timestamp after validation.
 */
function checksumForPersistedVersion(
  input: OwnerDirectEditInput,
  versionId: string,
  editedAt: Date,
  generationProvenance: Prisma.InputJsonValue,
): string {
  return computeContentItemVersionChecksum({
    id: versionId,
    contract_version: "content-v1",
    content_item_id: input.contentItemId,
    content_pack_id: input.contentPackId,
    version: input.newVersionNumber,
    channel: input.channel,
    format: input.format,
    language_mode: input.languageMode,
    strategy_trace: input.strategyTrace,
    caption_variants: input.captionVariants,
    cta: input.cta,
    hashtags: input.hashtags,
    creative_brief: input.creativeBrief,
    alt_text: input.altText,
    short_video_script: input.shortVideoScript,
    recommended_publish_window: input.recommendedPublishWindow,
    claim_sources: input.claimSources,
    warnings: input.warnings,
    blockers: input.blockers,
    asset_required: input.assetRequired,
    asset_ids: input.assetIds,
    generation_provenance: generationProvenance,
    created_at: editedAt.toISOString(),
  });
}

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
    transaction?: Prisma.TransactionClient,
  ): Promise<Prisma.ContentItemVersionGetPayload<Record<string, never>>> {
    const editedAt = new Date();
    const append = async (tx: Prisma.TransactionClient) => {
      const item = await tx.contentItem.findFirst({
        where: {
          id: input.contentItemId,
          contentPackId: input.contentPackId,
          currentVersionId: input.baseVersionId,
        },
        select: { id: true, status: true },
      });
      if (!item) {
        throw new ConflictException({
          code: "CONTENT_VERSION_CONFLICT",
          message:
            "The base version is no longer the current version. Refresh and retry.",
        });
      }
      assertNotApproved(item.status);
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
      const versionId = input.versionId ?? randomUUID();
      const generationProvenance = {
        generation_run_id: null,
        provider_name: "owner_direct_edit",
        provider_model: null,
        generated_at: editedAt.toISOString(),
      } as Prisma.InputJsonObject;
      const versionChecksum = checksumForPersistedVersion(
        input,
        versionId,
        editedAt,
        generationProvenance,
      );
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
          generationProvenance,
          versionChecksum,
          editKind: input.editKind ?? "owner_direct_edit",
          baseVersionId: input.baseVersionId,
          baseVersionChecksum: input.baseVersionChecksum,
          editedByUserId: input.editedByUserId,
          validationState: "validated",
          editedAt,
          createdAt: editedAt,
        },
      });
      await linkVersionAssets(
        tx,
        input.contentPackId,
        versionId,
        input.assetIds,
        input.altText,
      );
      await updateCurrentItemAfterEdit(tx, input, versionId);
      return version;
    };
    return transaction ? append(transaction) : this.prisma.$transaction(append);
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
        select: { id: true, status: true },
      });
      if (!item) {
        throw new ConflictException({
          code: "CONTENT_VERSION_CONFLICT",
          message:
            "The base version is no longer the current version. Refresh and retry.",
        });
      }
      assertNotApproved(item.status);
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
      const versionId = input.versionId ?? randomUUID();
      const generationProvenance = input.generationProvenance ?? {
        generation_run_id: null,
        provider_name: "ai_rewrite",
        provider_model: null,
        generated_at: editedAt.toISOString(),
      };
      const versionChecksum = checksumForPersistedVersion(
        input,
        versionId,
        editedAt,
        generationProvenance,
      );
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
          generationProvenance,
          versionChecksum,
          editKind: input.editKind ?? "ai_rewrite",
          baseVersionId: input.baseVersionId,
          baseVersionChecksum: input.baseVersionChecksum,
          editedByUserId: null,
          validationState: "validated",
          editedAt,
          createdAt: editedAt,
        },
      });
      await linkVersionAssets(
        tx,
        input.contentPackId,
        versionId,
        input.assetIds,
        input.altText,
      );
      await updateCurrentItemAfterEdit(tx, input, versionId);
      return version;
    });
  }
}

function assertNotApproved(status: string): void {
  if (status === "approved") {
    throw new ConflictException({
      code: "CONTENT_APPROVAL_BLOCKED",
      message: "Approved content is frozen and cannot be edited.",
    });
  }
}

async function updateCurrentItemAfterEdit(
  tx: Prisma.TransactionClient,
  input: OwnerDirectEditInput,
  versionId: string,
): Promise<void> {
  const result = await tx.contentItem.updateMany({
    where: {
      id: input.contentItemId,
      currentVersionId: input.baseVersionId,
      status: { not: "approved" },
    },
    data: { currentVersionId: versionId, status: "draft" },
  });
  if (result.count === 1) return;

  const latest = await tx.contentItem.findUnique({
    where: { id: input.contentItemId },
    select: { status: true },
  });
  if (latest?.status === "approved") {
    assertNotApproved(latest.status);
  }
  throw new ConflictException({
    code: "CONTENT_VERSION_CONFLICT",
    message:
      "The base version is no longer the current version. Refresh and retry.",
  });
}

async function linkVersionAssets(
  tx: Prisma.TransactionClient,
  contentPackId: string,
  contentItemVersionId: string,
  assetIds: readonly string[],
  altText: string,
): Promise<void> {
  if (assetIds.length === 0) return;
  const pack = await tx.contentPack.findUnique({
    where: { id: contentPackId },
    select: { contractVersion: true, contentCycleId: true },
  });
  for (const assetId of assetIds) {
    let asset = await tx.contentAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      const media =
        pack?.contractVersion === "content-v2"
          ? await tx.contentMediaLibraryEntry.findFirst({
              where: {
                id: assetId,
                contentCycleId: pack.contentCycleId,
                status: "ready",
              },
            })
          : null;
      if (media) {
        if (!media.storageKey || !media.checksum) {
          throw new ConflictException({
            code: "CONTENT_ASSET_REQUIRED",
            message: "The selected media is not ready for this post.",
          });
        }
        asset = await tx.contentAsset.create({
          data: {
            id: assetId,
            contentItemVersionId: null,
            // Normalize the v2 library's `owner_uploaded` label to the
            // ContentAsset/PublicationCandidate `owner_supplied` boundary.
            kind:
              media.kind === "generated_static"
                ? "generated_static"
                : "owner_supplied",
            status: "ready",
            mimeType: media.mimeType,
            width: media.width,
            height: media.height,
            storageKey: media.storageKey,
            checksum: media.checksum,
            altText,
            providerName: null,
            providerModel: null,
            providerRequestId: null,
            failureCode: null,
          },
        });
      } else if (
        pack?.contractVersion === "content-v2" &&
        assetId === deterministicGeneratedAssetId(contentItemVersionId)
      ) {
        asset = await tx.contentAsset.create({
          data: {
            id: assetId,
            contentItemVersionId: contentItemVersionId,
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
      } else {
        throw new ConflictException({
          code: "CONTENT_ASSET_REQUIRED",
          message: "The selected media is not available for this post.",
        });
      }
    }
    await tx.contentItemVersionAsset.upsert({
      where: {
        contentItemVersionId_assetId: {
          contentItemVersionId,
          assetId: asset.id,
        },
      },
      create: { contentItemVersionId, assetId: asset.id },
      update: {},
    });
  }
}
