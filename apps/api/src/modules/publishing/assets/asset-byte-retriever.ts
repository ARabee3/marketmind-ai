import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { RetrievedPublicationAssetV1 } from "@marketmind/contracts";
import { type AssetByteRetriever } from "../dispatch/asset-integrity-validator";
import { PublishingAssetStore } from "./publishing-asset.store";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import type { PublishingAssetReference } from "./publishing-asset.types";

/**
 * `LocalFilesystemAssetByteRetriever` — a committed demo/test adapter retained
 * for fixture tests. Production dispatch uses `ContentAssetByteRetriever`.
 *
 * It resolves each signed-dispatch `asset_id` through the committed
 * {@link PublishingAssetStore}, returning the immutable bytes + MIME type so
 * the frozen `validateRetrievedPublicationAssetsV1` can prove them against the
 * approved SHA-256 digests. Unknown ids throw `PUBLISHING_ASSET_UNAVAILABLE`
 * (fail closed) so a dispatch referencing an asset we do not have is blocked
 * honestly rather than faked.
 *
 * It deliberately remains outside the production module graph so demo assets
 * cannot be mistaken for a real Content/R2 publication path.
 */
@Injectable()
export class LocalFilesystemAssetByteRetriever implements AssetByteRetriever {
  private readonly logger = new Logger(LocalFilesystemAssetByteRetriever.name);

  constructor(private readonly store: PublishingAssetStore) {}

  async retrieve(
    assets: readonly (PublishingAssetReference | string)[],
  ): Promise<readonly RetrievedPublicationAssetV1[]> {
    const retrieved: RetrievedPublicationAssetV1[] = [];
    const missing: string[] = [];
    for (const asset of assets) {
      const id = typeof asset === "string" ? asset : asset.asset_id;
      const record = this.store.getAsset(id);
      if (!record) {
        missing.push(id);
        continue;
      }
      if (
        typeof asset !== "string" &&
        (record.mimeType !== asset.mime_type ||
          record.checksum !== asset.checksum)
      ) {
        throw new UnprocessableEntityException(
          `${PublishingErrorCode.ASSET_TAMPERED}: demo asset ${id} does not match the approved candidate`,
        );
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
