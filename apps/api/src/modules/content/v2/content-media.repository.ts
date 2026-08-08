import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ContentMediaLibraryEntry } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  CONTENT_V2_MEDIA_ALLOWED_MIME_TYPES,
  CONTENT_V2_MEDIA_MAX_BYTES,
  type ContentV2MediaFailureCode,
} from "@marketmind/contracts";

/**
 * Deterministic media upload validation (issue #187 media safety).
 *
 * Every accepted asset passes: allowed MIME allowlist, size limit (10 MiB),
 * magic-byte sniffing matching the declared type, image dimensions, and a
 * SHA-256 checksum of the exact bytes that get stored.
 */
export type MediaValidationResult =
  | { readonly valid: true; readonly width: number; readonly height: number }
  | {
      readonly valid: false;
      readonly failureCode: ContentV2MediaFailureCode;
      readonly message: string;
    };

const MAGIC_BYTES: ReadonlyArray<{
  readonly mime: string;
  readonly sniff: (buf: Buffer) => boolean;
}> = [
  {
    mime: "image/jpeg",
    sniff: (buf) =>
      buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: "image/png",
    sniff: (buf) =>
      buf.length > 8 &&
      buf
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    sniff: (buf) =>
      buf.length > 12 &&
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

function sniffMime(buf: Buffer): string | null {
  for (const candidate of MAGIC_BYTES) {
    if (candidate.sniff(buf)) {
      return candidate.mime;
    }
  }
  return null;
}

function readDimensions(
  buf: Buffer,
  mime: string,
): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (buf.length < 24) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1];
      if (
        marker === 0xd8 ||
        marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const length = buf.readUInt16BE(offset + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (offset + 9 >= buf.length) return null;
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
    return null;
  }
  if (mime === "image/webp") {
    const chunk = buf.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X" && buf.length >= 30) {
      return {
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    }
    if ((chunk === "VP8 " || chunk === "VP8L") && buf.length >= 30) {
      if (chunk === "VP8 ") {
        return {
          width: buf.readUInt16LE(26) & 0x3fff,
          height: buf.readUInt16LE(28) & 0x3fff,
        };
      }
      const b0 = buf[21];
      const b1 = buf[22];
      const b2 = buf[23];
      const b3 = buf[24];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    return null;
  }
  return null;
}

/** Lower-cases and strips parameters from a declared content type. */
export function normalizeDeclaredMime(declaredType: string): string {
  return declaredType.toLowerCase().split(";")[0].trim();
}

@Injectable()
export class ContentMediaValidator {
  /**
   * Validates a candidate upload. `declaredType` may be empty (probe only).
   */
  validateUpload(buffer: Buffer, declaredType: string): MediaValidationResult {
    const mime = normalizeDeclaredMime(declaredType);
    const allowlisted = (
      CONTENT_V2_MEDIA_ALLOWED_MIME_TYPES as readonly string[]
    ).includes(mime);
    if (!allowlisted) {
      return {
        valid: false,
        failureCode: "CONTENT_MEDIA_TYPE_UNSUPPORTED",
        message: `Unsupported content type "${mime || "unknown"}". Allowed: image/jpeg, image/png, image/webp.`,
      };
    }
    if (buffer.length > CONTENT_V2_MEDIA_MAX_BYTES) {
      return {
        valid: false,
        failureCode: "CONTENT_MEDIA_TOO_LARGE",
        message: `Upload exceeds the ${CONTENT_V2_MEDIA_MAX_BYTES / (1024 * 1024)} MiB limit.`,
      };
    }
    const sniffed = sniffMime(buffer);
    if (sniffed === null || sniffed !== mime) {
      return {
        valid: false,
        failureCode: "CONTENT_MEDIA_MAGIC_BYTE_MISMATCH",
        message: `File content does not match declared type "${mime}".`,
      };
    }
    const dimensions = readDimensions(buffer, mime);
    if (dimensions === null || dimensions.width < 1 || dimensions.height < 1) {
      return {
        valid: false,
        failureCode: "CONTENT_MEDIA_DIMENSIONS_INVALID",
        message: "Could not read valid image dimensions.",
      };
    }
    return { valid: true, ...dimensions };
  }

  checksum(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }
}

export type CreateMediaEntryInput = {
  readonly businessId: string;
  readonly contentCycleId: string;
  readonly ownerUserId: string;
  readonly kind: "owner_uploaded" | "generated_static";
  readonly status: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly checksum: string | null;
  readonly storageKey: string | null;
  readonly failureCode: string | null;
};

/**
 * Owner-scoped media-library persistence (issue #187). All reads verify the
 * caller owns the cycle; storage keys never leak beyond the storage layer.
 */
@Injectable()
export class ContentMediaLibraryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCycleOwned(
    tx: Prisma.TransactionClient,
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<void> {
    const cycle = await tx.contentCycle.findFirst({
      where: { id: contentCycleId, ownerUserId },
      select: { id: true },
    });
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }
  }

  async createEntry(
    input: CreateMediaEntryInput,
  ): Promise<ContentMediaLibraryEntry> {
    return this.prisma.contentMediaLibraryEntry.create({
      data: {
        businessId: input.businessId,
        contentCycleId: input.contentCycleId,
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        status: input.status,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        checksum: input.checksum,
        storageKey: input.storageKey,
        failureCode: input.failureCode,
      },
    });
  }

  async getEntryByIdAndCycle(
    contentCycleId: string,
    mediaId: string,
    ownerUserId: string,
  ): Promise<ContentMediaLibraryEntry | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      return tx.contentMediaLibraryEntry.findFirst({
        where: { id: mediaId, contentCycleId },
      });
    });
  }

  async listCycleEntries(
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<ContentMediaLibraryEntry[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      return tx.contentMediaLibraryEntry.findMany({
        where: { contentCycleId },
        orderBy: { createdAt: "asc" },
      });
    });
  }

  async updateStatus(
    mediaId: string,
    status: string,
    changes: Partial<{
      storageKey: string;
      checksum: string;
      width: number;
      height: number;
      mimeType: string;
      sizeBytes: number;
      failureCode: string;
    }>,
  ): Promise<ContentMediaLibraryEntry> {
    return this.prisma.contentMediaLibraryEntry.update({
      where: { id: mediaId },
      data: { status, ...changes },
    });
  }

  /** Revokes an entry owned by the caller (soft removal; snapshots keep refs). */
  async revokeEntry(
    contentCycleId: string,
    mediaId: string,
    ownerUserId: string,
  ): Promise<{ revoked: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      return tx.contentMediaLibraryEntry.updateMany({
        where: { id: mediaId, contentCycleId, status: { not: "revoked" } },
        data: { status: "revoked" },
      });
    });
    if (result.count === 0) {
      throw new NotFoundException("Media library entry not found");
    }
    return { revoked: true };
  }
}

/** Scoped storage key for owner media: `media/{cycleId}/{mediaId}.{ext}`. */
export function buildMediaStorageKey(
  contentCycleId: string,
  mediaId: string,
  mimeType: string,
): string {
  const ext =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";
  return `media/${contentCycleId}/${mediaId}.${ext}`;
}
