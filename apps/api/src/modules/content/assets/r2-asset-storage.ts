import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { AssetStorage } from "./asset-storage.port";

export type R2AssetStorageConfig = {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly region?: string;
  readonly usePathStyleEndpoint?: boolean;
};

/**
 * Cloudflare R2 implementation of the content asset boundary.
 *
 * R2 is S3-compatible, so the API can verify and serve the exact bytes that
 * the AI service writes without copying objects through the queue payload.
 * Storage keys remain opaque to callers, but are constrained to a relative
 * single-bucket key so a malformed value cannot escape the object namespace.
 */
@Injectable()
export class R2AssetStorage implements AssetStorage {
  private readonly client: S3Client;

  constructor(
    private readonly config: R2AssetStorageConfig,
    client?: S3Client,
  ) {
    const clientConfig: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region ?? "auto",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.usePathStyleEndpoint ?? true,
    };
    this.client = client ?? new S3Client(clientConfig);
  }

  async store(
    buffer: Buffer,
    storageKey: string,
  ): Promise<{ checksum: string; storageKey: string }> {
    validateStorageKey(storageKey);
    if (buffer.length === 0) {
      throw new ConflictException("Asset bytes must not be empty");
    }

    const checksum = createHash("sha256").update(buffer).digest("hex");
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
          Body: buffer,
          IfNoneMatch: "*",
          CacheControl: "private, max-age=3600",
        }),
      );
    } catch (error) {
      if (!isPreconditionFailure(error)) {
        throw error;
      }

      const existing = await this.retrieve(storageKey);
      const existingChecksum = createHash("sha256")
        .update(existing)
        .digest("hex");
      if (existingChecksum !== checksum || !existing.equals(buffer)) {
        throw new ConflictException(
          `Asset storage key '${storageKey}' already contains different bytes`,
        );
      }
    }

    return { checksum, storageKey };
  }

  async retrieve(storageKey: string): Promise<Buffer> {
    validateStorageKey(storageKey);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
        }),
      );
      if (!response.Body) {
        throw new NotFoundException(
          `Asset not found for storage key '${storageKey}'`,
        );
      }
      return bodyToBuffer(response.Body);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(
          `Asset not found for storage key '${storageKey}'`,
        );
      }
      throw error;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    validateStorageKey(storageKey);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
        }),
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    validateStorageKey(storageKey);
    if (!(await this.exists(storageKey))) {
      throw new NotFoundException(
        `Asset not found for storage key '${storageKey}'`,
      );
    }
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
      }),
    );
  }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new ConflictException("R2 returned an unreadable asset body");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

function validateStorageKey(storageKey: string): void {
  if (
    !storageKey ||
    storageKey.startsWith("/") ||
    storageKey.includes("\0") ||
    storageKey.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new NotFoundException(
      `Asset storage key '${storageKey}' is outside the configured bucket`,
    );
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    readonly name?: string;
    readonly Code?: string;
    readonly $metadata?: { readonly httpStatusCode?: number };
    readonly $response?: { readonly statusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.$response?.statusCode === 404
  );
}

function isPreconditionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    readonly name?: string;
    readonly Code?: string;
    readonly $metadata?: { readonly httpStatusCode?: number };
    readonly $response?: { readonly statusCode?: number };
  };
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.name === "ConditionalRequestConflict" ||
    candidate.Code === "PreconditionFailed" ||
    candidate.Code === "ConditionalRequestConflict" ||
    candidate.$metadata?.httpStatusCode === 412 ||
    candidate.$response?.statusCode === 412
  );
}
