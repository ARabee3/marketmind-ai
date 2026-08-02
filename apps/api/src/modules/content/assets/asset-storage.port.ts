/**
 * Asset storage port.
 *
 * Content asset bytes are never stored in JSON columns (arch doc 831); they
 * live behind this port so the persistence layer can be swapped (local
 * filesystem today, object storage later) without touching content code.
 */

export const CONTENT_ASSET_STORAGE = Symbol("CONTENT_ASSET_STORAGE");

export interface AssetStorage {
  /**
   * Persists raw bytes under `storageKey` and returns the SHA-256 checksum
   * of the stored buffer plus the key under which it was stored.
   */
  store(
    buffer: Buffer,
    storageKey: string,
  ): Promise<{ checksum: string; storageKey: string }>;

  /** Reads the bytes stored under `storageKey`. */
  retrieve(storageKey: string): Promise<Buffer>;

  /** Returns true when a blob exists under `storageKey`. */
  exists(storageKey: string): Promise<boolean>;

  /** Removes the blob stored under `storageKey`. */
  delete(storageKey: string): Promise<void>;
}

/**
 * Builds the canonical storage key for a content asset.
 *
 * Keyed by the immutable content item version so a regenerated revision never
 * overwrites a prior version's assets.
 */
export function buildAssetStorageKey(
  contentItemVersionId: string,
  assetId: string,
  ext: string,
): string {
  const normalizedExt = ext.startsWith(".") ? ext.slice(1) : ext;
  const safeExt = /^[a-z0-9]{1,8}$/i.test(normalizedExt)
    ? normalizedExt
    : "bin";

  return `${contentItemVersionId}/${assetId}.${safeExt}`;
}
