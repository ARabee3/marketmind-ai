import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFoundException } from "@nestjs/common";
import { AssetStorage, buildAssetStorageKey } from "./asset-storage.port";
import { LocalFilesystemAssetStorage } from "./local-filesystem-asset-storage";
import { R2AssetStorage } from "./r2-asset-storage";

describe("AssetStorage", () => {
  let root: string;
  let storage: AssetStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "marketmind-assets-"));
    storage = new LocalFilesystemAssetStorage(
      new ConfigService({ content: { assetRoot: root } }),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("buildAssetStorageKey", () => {
    it("builds a key from version, asset id and extension", () => {
      expect(buildAssetStorageKey("ver-1", "asset-42", "png")).toBe(
        "ver-1/asset-42.png",
      );
    });

    it("normalizes a leading dot on the extension", () => {
      expect(buildAssetStorageKey("ver-1", "asset-42", ".jpg")).toBe(
        "ver-1/asset-42.jpg",
      );
    });

    it("falls back to .bin for unsafe extensions", () => {
      expect(buildAssetStorageKey("ver-1", "asset-42", "../evil")).toBe(
        "ver-1/asset-42.bin",
      );
    });
  });

  describe("store + retrieve round-trip", () => {
    it("persists bytes and returns the SHA-256 checksum", async () => {
      const buffer = Buffer.from("round-trip-content", "utf8");
      const key = buildAssetStorageKey("ver-1", "asset-1", "txt");

      const result = await storage.store(buffer, key);

      expect(result.storageKey).toBe(key);
      expect(result.checksum).toBe(
        createHash("sha256").update(buffer).digest("hex"),
      );
      expect(await storage.retrieve(key)).toEqual(buffer);
    });

    it("computes the same checksum as the stored file bytes", async () => {
      const buffer = Buffer.from("checksum-match", "utf8");
      const key = buildAssetStorageKey("ver-2", "asset-2", "txt");

      const { checksum } = await storage.store(buffer, key);
      const onDisk = await storage.retrieve(key);

      expect(createHash("sha256").update(onDisk).digest("hex")).toBe(checksum);
    });
  });

  describe("exists", () => {
    it("returns true for a stored key and false for a missing one", async () => {
      const key = buildAssetStorageKey("ver-3", "asset-3", "txt");
      await storage.store(Buffer.from("exists-check"), key);

      expect(await storage.exists(key)).toBe(true);
      expect(
        await storage.exists(buildAssetStorageKey("ver-3", "nope", "txt")),
      ).toBe(false);
    });
  });

  describe("delete", () => {
    it("removes the blob so retrieve throws 404", async () => {
      const key = buildAssetStorageKey("ver-4", "asset-4", "txt");
      await storage.store(Buffer.from("to-be-deleted"), key);

      await storage.delete(key);

      expect(await storage.exists(key)).toBe(false);
      await expect(storage.retrieve(key)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws 404 when deleting a missing key", async () => {
      await expect(
        storage.delete(buildAssetStorageKey("ver-4", "never-stored", "txt")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("retrieve", () => {
    it("throws 404 for a missing key", async () => {
      await expect(
        storage.retrieve(buildAssetStorageKey("ver-9", "missing", "txt")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("path confinement", () => {
    it("rejects a storage key that escapes the asset root", async () => {
      const escaped = join("..", "escape", "asset.txt");
      await expect(
        storage.store(Buffer.from("x"), escaped),
      ).rejects.toBeInstanceOf(NotFoundException);
      const entries = await readdir(root);
      expect(entries).not.toContain("escape");
    });
  });
});

describe("R2AssetStorage", () => {
  const config = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    bucket: "marketmind-ai",
  };

  it("stores and retrieves bytes through the S3-compatible client", async () => {
    const send = jest.fn();
    const client = { send } as unknown as S3Client;
    const storage = new R2AssetStorage(config, client);
    const buffer = Buffer.from("r2-round-trip", "utf8");
    const key = "content/generated/asset-1.jpg";

    send.mockResolvedValueOnce({});
    const stored = await storage.store(buffer, key);

    expect(stored).toEqual({
      storageKey: key,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    });
    expect(send).toHaveBeenCalledTimes(1);

    send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => new Uint8Array(buffer),
      },
    });
    await expect(storage.retrieve(key)).resolves.toEqual(buffer);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("returns false for a missing object and rejects unsafe keys", async () => {
    const send = jest.fn();
    const client = { send } as unknown as S3Client;
    const storage = new R2AssetStorage(config, client);
    const missing = Object.assign(new Error("missing"), { name: "NotFound" });

    send.mockRejectedValueOnce(missing);
    await expect(storage.exists("media/cycle/missing.jpg")).resolves.toBe(
      false,
    );
    await expect(storage.retrieve("../outside.jpg")).rejects.toThrow(
      "outside the configured bucket",
    );
  });

  it("deletes an existing object and preserves the missing-object contract", async () => {
    const send = jest.fn();
    const client = { send } as unknown as S3Client;
    const storage = new R2AssetStorage(config, client);
    const key = "media/cycle/media-1.jpg";

    send.mockResolvedValueOnce({});
    send.mockResolvedValueOnce({});
    await expect(storage.delete(key)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);

    const missing = Object.assign(new Error("missing"), { name: "NoSuchKey" });
    send.mockRejectedValueOnce(missing);
    await expect(storage.delete(key)).rejects.toThrow("Asset not found");
  });
});
