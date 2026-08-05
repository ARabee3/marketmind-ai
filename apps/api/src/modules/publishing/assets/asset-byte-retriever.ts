import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { RetrievedPublicationAssetV1 } from "@marketmind/contracts";
import {
  type AssetByteRetriever,
} from "../dispatch/asset-integrity-validator";
import { PublishingAssetStore } from "./publishing-asset.store";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

/**
 * `LocalFilesystemAssetByteRetriever` — the real #121 byte-retrieval boundary
 * that the dispatch-time {@link AssetIntegrityValidator} asks for candidate
 * media bytes before any provider call.
 *
 * It resolves each signed-dispatch `asset_id` through the committed
 * {@link PublishingAssetStore}, returning the immutable bytes + MIME type so
 * the frozen `validateRetrievedPublicationAssetsV1` can prove them against the
 * approved SHA-256 digests. Unknown ids throw `PUBLISHING_ASSET_UNAVAILABLE`
 * (fail closed) so a dispatch referencing an asset we do not have is blocked
 * honestly rather than faked.
 *
 * TODO(#121-prod): swap this local-filesystem store behind an object-storage /
 * signed-URL retriever without touching the dispatch processor — the
 * `AssetByteRetriever` interface is the seam.
 */
@Injectable()
export class LocalFilesystemAssetByteRetriever implements AssetByteRetriever {
  private readonly logger = new Logger(LocalFilesystemAssetByteRetriever.name);

  constructor(private readonly store: PublishingAssetStore) {}

  async retrieve(
    assetIds: readonly string[],
  ): Promise<readonly RetrievedPublicationAssetV1[]> {
    const retrieved: RetrievedPublicationAssetV1[] = [];
    const missing: string[] = [];
    for (const id of assetIds) {
      const record = this.store.getAsset(id);
      if (!record) {
        missing.push(id);
        continue;
      }
      retrieved.push({
        asset_id: record.id,
        mime_type: record.mimeType,
        // Buffer is a Uint8Array subclass; the contract validator checks
        // `bytes instanceof Uint8Array`, which Buffer satisfies.
        bytes: new Uint8Array(
          record.bytes.buffer,
          record.bytes.byteOffset,
          record.bytes.byteLength,
        ),
      });
    }
    if (missing.length > 0) {
      this.logger.warn(
        `Asset retrieval unavailable for ${missing.length} id(s) — real dispatch blocked`,
      );
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.ASSET_UNAVAILABLE}: asset bytes not found for ids: ${missing.join(", ")}`,
      );
    }
    return retrieved;
  }
}