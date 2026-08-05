import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AssetStorage } from "./asset-storage.port";

const TMP_SUFFIX = ".tmp";

/**
 * Local filesystem implementation of the AssetStorage port.
 *
 * Writes are atomic (write to a temp sibling, then rename) so a reader never
 * observes a partially-written blob. Blobs live under the configured root;
 * the root is resolved against process.cwd() and every key is confined to it
 * so a crafted storage key cannot escape the asset directory.
 */
@Injectable()
export class LocalFilesystemAssetStorage implements AssetStorage {
  private readonly logger = new Logger(LocalFilesystemAssetStorage.name);
  private readonly root: string;

  constructor(configService: ConfigService) {
    const configured = configService.get<string>("content.assetRoot");
    this.root = resolve(configured ?? "./.content-assets");
  }

  async store(
    buffer: Buffer,
    storageKey: string,
  ): Promise<{ checksum: string; storageKey: string }> {
    const filePath = this.confine(storageKey);
    await mkdir(dirname(filePath), { recursive: true });

    const tempPath = `${filePath}${TMP_SUFFIX}`;
    await writeFile(tempPath, buffer);
    await rename(tempPath, filePath);

    const checksum = createHash("sha256").update(buffer).digest("hex");
    this.logger.debug(`Stored asset ${storageKey} (${buffer.length} bytes)`);
    return { checksum, storageKey };
  }

  async retrieve(storageKey: string): Promise<Buffer> {
    const filePath = this.confine(storageKey);
    try {
      return await readFile(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new NotFoundException(
          `Asset not found for storage key '${storageKey}'`,
        );
      }
      throw error;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const filePath = this.confine(storageKey);
    try {
      await readFile(filePath);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = this.confine(storageKey);
    try {
      await unlink(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new NotFoundException(
          `Asset not found for storage key '${storageKey}'`,
        );
      }
      throw error;
    }
  }

  private confine(storageKey: string): string {
    const resolved = resolve(this.root, storageKey);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${sep}`)) {
      throw new NotFoundException(
        `Asset storage key '${storageKey}' is outside the asset root`,
      );
    }
    return resolved;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
