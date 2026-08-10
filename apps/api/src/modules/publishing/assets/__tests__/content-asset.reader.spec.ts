import { createHash } from "node:crypto";
import { UnprocessableEntityException } from "@nestjs/common";
import { ContentAssetReader } from "../content-asset.reader";
import { ContentAssetByteRetriever } from "../content-asset-byte-retriever";

describe("ContentAssetReader", () => {
  const assetId = "11111111-1111-4111-8111-111111111111";
  const storageKey = "content/asset.png";
  const bytes = Buffer.from("approved-r2-bytes", "utf8");
  const checksum = createHash("sha256").update(bytes).digest("hex");

  function makeReader(overrides?: {
    readonly metadata?: Record<string, unknown> | null;
    readonly retrieve?: jest.Mock;
  }) {
    const prisma = {
      contentAsset: {
        findUnique: jest.fn().mockResolvedValue(
          overrides && "metadata" in overrides
            ? overrides.metadata
            : {
                id: assetId,
                status: "ready",
                mimeType: "image/png",
                storageKey,
                checksum,
              },
        ),
      },
      contentMediaLibraryEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const storage = {
      retrieve: overrides?.retrieve ?? jest.fn().mockResolvedValue(bytes),
    };
    return {
      reader: new ContentAssetReader(prisma as any, storage as any),
      prisma,
      storage,
    };
  }

  it("reads and verifies bytes through the configured storage port", async () => {
    const { reader, storage } = makeReader();

    const record = await reader.readApprovedAsset({
      asset_id: assetId,
      mime_type: "image/png",
      storage_key: storageKey,
      checksum,
    });

    expect(storage.retrieve).toHaveBeenCalledWith(storageKey);
    expect(record).toMatchObject({
      id: assetId,
      mimeType: "image/png",
      checksum,
      bytes,
    });
  });

  it("rejects a changed approved storage reference", async () => {
    const { reader, storage } = makeReader();

    await expect(
      reader.readApprovedAsset({
        asset_id: assetId,
        mime_type: "image/png",
        storage_key: "content/changed.png",
        checksum,
      }),
    ).rejects.toThrow(/PUBLISHING_ASSET_TAMPERED/);
    expect(storage.retrieve).not.toHaveBeenCalled();
  });

  it("rejects bytes that do not match the stored checksum", async () => {
    const { reader } = makeReader({
      retrieve: jest.fn().mockResolvedValue(Buffer.from("changed-bytes")),
    });

    await expect(reader.readAssetById(assetId)).rejects.toThrow(
      /PUBLISHING_ASSET_TAMPERED/,
    );
  });

  it("maps storage failures to a sanitized unavailable error", async () => {
    const { reader } = makeReader({
      retrieve: jest.fn().mockRejectedValue(new Error("secret R2 detail")),
    });

    await expect(reader.readAssetById(assetId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(reader.readAssetById(assetId)).rejects.toThrow(
      /PUBLISHING_ASSET_UNAVAILABLE/,
    );
  });

  it("lets the production retriever return verified Content bytes", async () => {
    const { reader } = makeReader();
    const retriever = new ContentAssetByteRetriever(reader);

    const retrieved = await retriever.retrieve([
      {
        asset_id: assetId,
        mime_type: "image/png",
        storage_key: storageKey,
        checksum,
      },
    ]);

    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].asset_id).toBe(assetId);
    expect(retrieved[0].bytes).toEqual(new Uint8Array(bytes));
  });
});
