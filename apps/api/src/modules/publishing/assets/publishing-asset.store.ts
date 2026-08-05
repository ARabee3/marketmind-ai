import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Manifest entry binding a committed immutable demo asset to its bytes.
 * `checksum` is the real SHA-256 of the referenced file — the exact value that
 * must appear in every `PublicationCandidateV1.assets[].checksum` field, the
 * seed script, and the dispatch-time integrity check.
 */
export interface PublishingAssetManifestEntry {
  readonly file: string;
  readonly mime_type: string;
  readonly checksum: string;
  readonly alt_text?: string;
}

export interface PublishingAssetRecord {
  readonly id: string;
  readonly mimeType: string;
  readonly checksum: string;
  readonly bytes: Buffer;
}

/** Frozen manifest contract version — bumped only on a breaking schema change. */
export const PUBLISHING_ASSET_MANIFEST_VERSION =
  "publishing-asset-manifest-v1" as const;

/**
 * `PublishingAssetStore` — the #121 internal asset-serving boundary that backs
 * `GET /internal/v1/publishing/assets/:id` and the dispatch-time
 * {@link AssetByteRetriever}.
 *
 * It loads a committed manifest (`apps/api/test-assets/publishing/manifest.json`)
 * that binds an `asset_id` to a file, its MIME type, and its real SHA-256
 * digest, then proves every referenced file's on-disk checksum matches the
 * manifest at startup. A drift excludes the asset (fail closed) so dispatch can
 * never proceed against bytes that no longer match the approved digest. This is
 * a local-filesystem store only; object storage is a future concern and the
 * retriever interface is the seam it swaps behind.
 *
 * NOTE: bytes are held in memory for the committed demo assets. These are tiny
 * (one PNG); a real object-store-backed implementation would stream instead.
 */
@Injectable()
export class PublishingAssetStore implements OnModuleInit {
  private readonly logger = new Logger(PublishingAssetStore.name);
  private readonly baseDir: string;
  private readonly records = new Map<string, PublishingAssetRecord>();

  constructor(config: ConfigService) {
    // Defaults to the committed test-assets dir relative to the process cwd so
    // `nest start` and ts-node both resolve it without extra config.
    this.baseDir = config.get<string>(
      "publishing.assetStoreDir",
      path.resolve(process.cwd(), "test-assets/publishing"),
    );
  }

  async onModuleInit(): Promise<void> {
    this.loadManifest();
  }

  /** Synchronously load + verify the manifest. Safe to call once at boot. */
  loadManifest(): void {
    const manifestPath = path.join(this.baseDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      this.logger.warn(
        `Asset manifest not found at ${manifestPath} — no demo assets will be served (#121 boundary inert)`,
      );
      return;
    }
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      contract_version?: string;
      assets?: Record<string, PublishingAssetManifestEntry>;
    };
    if (raw.contract_version !== PUBLISHING_ASSET_MANIFEST_VERSION) {
      this.logger.error(
        `Asset manifest contract_version mismatch (got ${raw.contract_version ?? "<none>"}) — refusing to load`,
      );
      return;
    }
    const assets = raw.assets ?? {};
    for (const [id, entry] of Object.entries(assets)) {
      const filePath = path.join(this.baseDir, entry.file);
      if (!fs.existsSync(filePath)) {
        this.logger.error(
          `Asset ${id} references missing file ${filePath} — excluded`,
        );
        continue;
      }
      const bytes = fs.readFileSync(filePath);
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      if (digest !== entry.checksum) {
        this.logger.error(
          `Asset ${id} checksum drift: manifest=${entry.checksum} ondisk=${digest} — excluded (fail closed)`,
        );
        continue;
      }
      this.records.set(id, {
        id,
        mimeType: entry.mime_type,
        checksum: digest,
        bytes,
      });
      this.logger.log(
        `Loaded demo asset ${id} (${entry.mime_type}, ${bytes.length} bytes)`,
      );
    }
  }

  getAsset(id: string): PublishingAssetRecord | null {
    return this.records.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** All known asset ids — used by the retriever to resolve requested ids. */
  knownIds(): readonly string[] {
    return [...this.records.keys()];
  }
}