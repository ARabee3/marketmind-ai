/**
 * The immutable media reference carried by an approved publication
 * candidate. These fields are copied from Content at approval time; the
 * storage key is never accepted from a browser or from n8n.
 */
export interface PublishingAssetReference {
  readonly asset_id: string;
  readonly mime_type: string;
  readonly storage_key: string;
  readonly checksum: string;
}

export interface PublishingAssetRecord {
  readonly id: string;
  readonly mimeType: string;
  readonly checksum: string;
  readonly bytes: Buffer;
}

export interface PublishingAssetReader {
  readApprovedAsset(
    reference: PublishingAssetReference,
  ): Promise<PublishingAssetRecord | null>;
  readAssetById(assetId: string): Promise<PublishingAssetRecord | null>;
}
