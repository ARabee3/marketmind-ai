import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PublicationCandidateV1 } from "@marketmind/contracts";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { PublishingAssetStore } from "../assets/publishing-asset.store";

export const EXPORT_DESTINATION_PREFIX = "publishing-export:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function artifactIdFromDestinationRef(
  destinationRef: string,
): string | null {
  if (!destinationRef.startsWith(EXPORT_DESTINATION_PREFIX)) return null;
  const artifactId = destinationRef.slice(EXPORT_DESTINATION_PREFIX.length);
  return UUID_PATTERN.test(artifactId) ? artifactId : null;
}

interface ArchiveEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

interface ExportManifestAsset {
  readonly asset_id: string;
  readonly archive_path: string;
  readonly mime_type: string;
  readonly checksum: string;
}

export interface CreatedManualExportArchive {
  readonly artifactId: string;
  readonly checksum: string;
  readonly destinationRef: string;
  readonly fileName: string;
  readonly mimeType: "application/gzip";
  /**
   * The frozen `publication-export-manifest-v1` payload written into the
   * archive. The API persists it so `GET /export` can surface identity,
   * label, and checksums without re-parsing the tar.gz.
   */
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface ReadManualExportArchive
  extends Omit<CreatedManualExportArchive, "manifest"> {
  readonly bytes: Buffer;
}

/**
 * Builds and stores the real checksum-addressed manual export artifact.
 *
 * The archive is a deterministic tar.gz package containing the frozen caption,
 * hashtags, alt text, posting notes, README, manifest, and exact approved media
 * bytes. The database stores only an opaque destination reference and the
 * archive SHA-256; absolute filesystem paths never leave this service.
 */
@Injectable()
export class ManualExportArchiveService {
  private readonly rootDir: string;

  constructor(
    config: ConfigService,
    private readonly assetStore: PublishingAssetStore,
  ) {
    this.rootDir = path.resolve(
      config.get<string>(
        "publishing.exportStoreDir",
        path.resolve(process.cwd(), ".publishing-exports"),
      ),
    );
  }

  createArchive(input: {
    artifactId: string;
    intentId: string;
    candidate: PublicationCandidateV1;
    generatedAt: Date;
  }): CreatedManualExportArchive {
    const { artifactId, intentId, candidate, generatedAt } = input;
    this.assertArtifactId(artifactId);

    const mediaEntries: ArchiveEntry[] = [];
    const manifestAssets: ExportManifestAsset[] = [];
    for (const asset of candidate.assets) {
      const record = this.assetStore.getAsset(asset.asset_id);
      if (!record) {
        throw new UnprocessableEntityException(
          `${PublishingErrorCode.ASSET_UNAVAILABLE}: export asset ${asset.asset_id} is unavailable`,
        );
      }

      const digest = this.sha256(record.bytes);
      if (
        digest !== asset.checksum ||
        record.checksum !== asset.checksum ||
        record.mimeType !== asset.mime_type
      ) {
        throw new UnprocessableEntityException(
          `${PublishingErrorCode.ASSET_TAMPERED}: export asset ${asset.asset_id} does not match the approved candidate`,
        );
      }

      const archivePath = `media/${asset.asset_id}.${this.extensionForMime(
        asset.mime_type,
      )}`;
      mediaEntries.push({ name: archivePath, bytes: record.bytes });
      manifestAssets.push({
        asset_id: asset.asset_id,
        archive_path: archivePath,
        mime_type: asset.mime_type,
        checksum: asset.checksum,
      });
    }

    const generatedAtIso = generatedAt.toISOString();
    // Frozen `publication-export-manifest-v1` field names (issue #118) so the
    // manifest inside the archive is structurally identical to what the API
    // returns and the web renders. `manifest_checksum`, `intent_id`,
    // `business_id`, `recommended_publish_window`, and per-asset `mime_type`
    // are archive-only extras the frozen contract tolerates at runtime.
    const manifestBase = {
      contract_version: "publishing-export-manifest-v1",
      artifact_id: artifactId,
      intent_id: intentId,
      candidate_id: candidate.candidate_id,
      business_id: candidate.business_id,
      content_item_id: candidate.content_item_id,
      content_item_version_id: candidate.content_item_version_id,
      content_item_version: candidate.content_item_version,
      candidate_checksum: candidate.candidate_checksum,
      target_channel: candidate.target_channel,
      content_format: candidate.content_format,
      selected_locale: candidate.selected_locale,
      label: "EXPORTED_NOT_PUBLISHED",
      recommended_publish_window: candidate.recommended_publish_window,
      generated_at: generatedAtIso,
      assets: manifestAssets,
      manifest_checksum: "",
    };
    const manifestChecksum = this.sha256(
      Buffer.from(JSON.stringify(manifestBase), "utf8"),
    );
    const manifest = {
      ...manifestBase,
      manifest_checksum: manifestChecksum,
    };

    const captionFile =
      candidate.selected_locale === "ar" ? "caption-ar.txt" : "caption-en.txt";
    const entries: ArchiveEntry[] = [
      {
        name: "manifest.json",
        bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      },
      {
        name: captionFile,
        bytes: Buffer.from(`${candidate.caption}\n`, "utf8"),
      },
      {
        name: "hashtags.txt",
        bytes: Buffer.from(`${candidate.hashtags.join("\n")}\n`, "utf8"),
      },
      {
        name: "alt-text.txt",
        bytes: Buffer.from(`${candidate.alt_text}\n`, "utf8"),
      },
      {
        name: "posting-notes.txt",
        bytes: Buffer.from(
          [
            `Channel: ${candidate.target_channel}`,
            `Format: ${candidate.content_format}`,
            `Locale: ${candidate.selected_locale}`,
            `Recommended start: ${candidate.recommended_publish_window.starts_at}`,
            `Recommended end: ${candidate.recommended_publish_window.ends_at}`,
            `Timezone: ${candidate.recommended_publish_window.timezone}`,
            "Owner action required: this export has not been published automatically.",
            "",
          ].join("\n"),
          "utf8",
        ),
      },
      {
        name: "README.txt",
        bytes: Buffer.from(
          [
            "MarketMind manual publishing export",
            "",
            "This checksum-addressed package contains the exact approved content and media.",
            "It is an export for manual owner posting, not proof of a remote publication.",
            "Verify manifest.json and every media checksum before posting.",
            "",
          ].join("\n"),
          "utf8",
        ),
      },
      ...mediaEntries,
    ];

    const archiveBytes = zlib.gzipSync(
      this.buildTar(entries, Math.floor(generatedAt.getTime() / 1000)),
      { level: 9 },
    );
    const archiveChecksum = this.sha256(archiveBytes);
    const fileName = `${artifactId}.tar.gz`;

    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    const finalPath = this.pathForArtifact(artifactId);
    const temporaryPath = path.join(
      this.rootDir,
      `.${artifactId}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    try {
      fs.writeFileSync(temporaryPath, archiveBytes, {
        mode: 0o600,
        flag: "wx",
      });
      fs.renameSync(temporaryPath, finalPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }

    return {
      artifactId,
      checksum: archiveChecksum,
      destinationRef: `${EXPORT_DESTINATION_PREFIX}${artifactId}`,
      fileName,
      mimeType: "application/gzip",
      manifest,
    };
  }

  readArchive(
    destinationRef: string,
    expectedChecksum: string,
  ): ReadManualExportArchive {
    if (!destinationRef.startsWith(EXPORT_DESTINATION_PREFIX)) {
      throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    }
    const artifactId = destinationRef.slice(EXPORT_DESTINATION_PREFIX.length);
    this.assertArtifactId(artifactId);
    const archivePath = this.pathForArtifact(artifactId);
    if (!fs.existsSync(archivePath)) {
      throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    }
    const bytes = fs.readFileSync(archivePath);
    const checksum = this.sha256(bytes);
    if (checksum !== expectedChecksum) {
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.ASSET_TAMPERED}: stored export archive checksum mismatch`,
      );
    }
    return {
      artifactId,
      bytes,
      checksum,
      destinationRef,
      fileName: `${artifactId}.tar.gz`,
      mimeType: "application/gzip",
    };
  }

  private buildTar(entries: readonly ArchiveEntry[], mtime: number): Buffer {
    const chunks: Buffer[] = [];
    for (const entry of entries) {
      const nameBytes = Buffer.from(entry.name, "utf8");
      if (nameBytes.length > 100) {
        throw new Error(`Export archive path is too long: ${entry.name}`);
      }
      const header = Buffer.alloc(512, 0);
      nameBytes.copy(header, 0);
      this.writeTarOctal(header, 100, 8, 0o644);
      this.writeTarOctal(header, 108, 8, 0);
      this.writeTarOctal(header, 116, 8, 0);
      this.writeTarOctal(header, 124, 12, entry.bytes.length);
      this.writeTarOctal(header, 136, 12, mtime);
      header.fill(0x20, 148, 156);
      header[156] = "0".charCodeAt(0);
      header.write("ustar\0", 257, "ascii");
      header.write("00", 263, "ascii");
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      const encodedChecksum = checksum.toString(8).padStart(6, "0");
      header.write(encodedChecksum, 148, 6, "ascii");
      header[154] = 0;
      header[155] = 0x20;
      chunks.push(header, entry.bytes);
      const remainder = entry.bytes.length % 512;
      if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder, 0));
    }
    chunks.push(Buffer.alloc(1024, 0));
    return Buffer.concat(chunks);
  }

  private writeTarOctal(
    target: Buffer,
    offset: number,
    length: number,
    value: number,
  ): void {
    const encoded = value.toString(8).padStart(length - 1, "0");
    target.write(encoded, offset, length - 1, "ascii");
    target[offset + length - 1] = 0;
  }

  private pathForArtifact(artifactId: string): string {
    this.assertArtifactId(artifactId);
    return path.join(this.rootDir, `${artifactId}.tar.gz`);
  }

  private assertArtifactId(artifactId: string): void {
    if (!UUID_PATTERN.test(artifactId)) {
      throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    }
  }

  private extensionForMime(mimeType: string): string {
    switch (mimeType) {
      case "image/png":
        return "png";
      case "image/jpeg":
        return "jpg";
      case "image/webp":
        return "webp";
      default:
        return "bin";
    }
  }

  private sha256(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
  }
}
