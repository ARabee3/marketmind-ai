import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  CONTENT_ASSET_STORAGE,
  type AssetStorage,
} from "../../content/assets/asset-storage.port";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import type {
  PublishingAssetReader,
  PublishingAssetRecord,
  PublishingAssetReference,
} from "./publishing-asset.types";

type AssetMetadata = {
  readonly id: string;
  readonly status: string;
  readonly mimeType: string | null;
  readonly storageKey: string | null;
  readonly checksum: string | null;
};

/**
 * Reads the exact bytes approved by Content through the shared storage port.
 *
 * Content v1 and v2 can use the same reader: v1 candidates carry a normalized
 * `ContentAsset` row and v2 media entries are used as a fallback for routes
 * that run before the attachment normalization. Every path verifies the
 * approved storage key, MIME type, and SHA-256 before returning bytes.
 */
@Injectable()
export class ContentAssetReader implements PublishingAssetReader {
  private readonly logger = new Logger(ContentAssetReader.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTENT_ASSET_STORAGE)
    private readonly assetStorage: AssetStorage,
  ) {}

  async readApprovedAsset(
    reference: PublishingAssetReference,
  ): Promise<PublishingAssetRecord | null> {
    const metadata = await this.findMetadata(reference.asset_id);
    if (!this.isReady(metadata)) return null;

    if (
      metadata.storageKey !== reference.storage_key ||
      metadata.checksum !== reference.checksum ||
      metadata.mimeType !== reference.mime_type
    ) {
      throw this.tampered(reference.asset_id);
    }

    return this.readVerified(metadata);
  }

  async readAssetById(assetId: string): Promise<PublishingAssetRecord | null> {
    const metadata = await this.findMetadata(assetId);
    if (!this.isReady(metadata)) return null;
    return this.readVerified(metadata);
  }

  private async findMetadata(assetId: string): Promise<AssetMetadata | null> {
    const contentAsset = await this.prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        status: true,
        mimeType: true,
        storageKey: true,
        checksum: true,
      },
    });
    if (contentAsset) return contentAsset;

    const mediaEntry = await this.prisma.contentMediaLibraryEntry.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        status: true,
        mimeType: true,
        storageKey: true,
        checksum: true,
      },
    });
    return mediaEntry;
  }

  private isReady(metadata: AssetMetadata | null): metadata is AssetMetadata & {
    readonly status: "ready";
    readonly mimeType: string;
    readonly storageKey: string;
    readonly checksum: string;
  } {
    return Boolean(
      metadata &&
      metadata.status === "ready" &&
      metadata.mimeType &&
      metadata.storageKey &&
      metadata.checksum,
    );
  }

  private async readVerified(
    metadata: AssetMetadata & {
      readonly status: "ready";
      readonly mimeType: string;
      readonly storageKey: string;
      readonly checksum: string;
    },
  ): Promise<PublishingAssetRecord> {
    let bytes: Buffer;
    try {
      bytes = await this.assetStorage.retrieve(metadata.storageKey);
    } catch {
      this.logger.warn(
        `Asset ${metadata.id} could not be retrieved from configured storage`,
      );
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.ASSET_UNAVAILABLE}: approved asset bytes are unavailable`,
      );
    }

    if (bytes.length === 0) {
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.ASSET_UNAVAILABLE}: approved asset bytes are empty`,
      );
    }

    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== metadata.checksum) {
      throw this.tampered(metadata.id);
    }

    return {
      id: metadata.id,
      mimeType: metadata.mimeType,
      checksum,
      bytes,
    };
  }

  private tampered(assetId: string): UnprocessableEntityException {
    this.logger.warn(
      `Asset ${assetId} metadata or bytes failed integrity verification`,
    );
    return new UnprocessableEntityException(
      `${PublishingErrorCode.ASSET_TAMPERED}: approved asset integrity verification failed`,
    );
  }
}
