import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { RetrievedPublicationAssetV1 } from "@marketmind/contracts";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import type { AssetByteRetriever } from "../dispatch/asset-integrity-validator";
import { ContentAssetReader } from "./content-asset.reader";
import type { PublishingAssetReference } from "./publishing-asset.types";

/**
 * Production byte retriever for approved Content media.
 *
 * The candidate's storage key is part of the frozen approved payload, so this
 * adapter never guesses a key from an asset id and never falls back to the
 * committed demo manifest. The reader verifies the current metadata and the
 * bytes before this adapter hands them to the frozen publishing validator.
 */
@Injectable()
export class ContentAssetByteRetriever implements AssetByteRetriever {
  constructor(private readonly reader: ContentAssetReader) {}

  async retrieve(
    assets: readonly (PublishingAssetReference | string)[],
  ): Promise<readonly RetrievedPublicationAssetV1[]> {
    const retrieved: RetrievedPublicationAssetV1[] = [];
    const missing: string[] = [];

    for (const asset of assets) {
      if (typeof asset === "string") {
        missing.push(asset);
        continue;
      }

      const record = await this.reader.readApprovedAsset(asset);
      if (!record) {
        missing.push(asset.asset_id);
        continue;
      }

      retrieved.push({
        asset_id: record.id,
        mime_type: record.mimeType,
        bytes: new Uint8Array(
          record.bytes.buffer,
          record.bytes.byteOffset,
          record.bytes.byteLength,
        ),
      });
    }

    if (missing.length > 0) {
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.ASSET_UNAVAILABLE}: approved asset bytes not found for ids: ${missing.join(", ")}`,
      );
    }

    return retrieved;
  }
}
