import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  PublishingAssetStore,
  PUBLISHING_ASSET_MANIFEST_VERSION,
} from "../publishing-asset.store";
import { LocalFilesystemAssetByteRetriever } from "../asset-byte-retriever";

/**
 * Proves the committed demo asset round-trips: the manifest checksum equals the
 * on-disk file's real SHA-256 (the exact value used in the seed candidate +
 * dispatch integrity check), and the #121 retriever returns those bytes so the
 * frozen validateRetrievedPublicationAssetsV1 can bind them.
 */
describe("PublishingAssetStore (#121)", () => {
  const storeDir = path.resolve(process.cwd(), "test-assets/publishing");

  function makeStore() {
    return new PublishingAssetStore({
      get: (key: string) =>
        key === "publishing.assetStoreDir" ? storeDir : undefined,
    } as unknown as ConfigService);
  }

  it("manifest and demo file are committed and the checksum matches", () => {
    expect(fs.existsSync(path.join(storeDir, "manifest.json"))).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(storeDir, "manifest.json"), "utf8"),
    );
    expect(manifest.contract_version).toBe(PUBLISHING_ASSET_MANIFEST_VERSION);
    const [id, entry] = Object.entries(manifest.assets)[0] as [
      string,
      { file: string; checksum: string; mime_type: string },
    ];
    const bytes = fs.readFileSync(path.join(storeDir, entry.file));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(entry.checksum);
    expect(id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("loads the committed asset and serves immutable bytes with the manifest digest", async () => {
    const store = makeStore();
    await store.onModuleInit();
    const record = store.getAsset("11111111-1111-4111-8111-111111111111");
    expect(record).not.toBeNull();
    expect(record!.mimeType).toBe("image/png");
    const digest = crypto
      .createHash("sha256")
      .update(record!.bytes)
      .digest("hex");
    expect(digest).toBe(record!.checksum);
  });

  it("retriever resolves the asset id to RetrievedPublicationAssetV1 bytes", async () => {
    const store = makeStore();
    await store.onModuleInit();
    const retriever = new LocalFilesystemAssetByteRetriever(store);
    const retrieved = await retriever.retrieve([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].mime_type).toBe("image/png");
    expect(retrieved[0].bytes instanceof Uint8Array).toBe(true);
    expect(retrieved[0].bytes.byteLength).toBeGreaterThan(0);
  });

  it("retriever fails closed with ASSET_UNAVAILABLE for an unknown id", async () => {
    const store = makeStore();
    await store.onModuleInit();
    const retriever = new LocalFilesystemAssetByteRetriever(store);
    await expect(
      retriever.retrieve(["00000000-0000-4000-8000-000000000000"]),
    ).rejects.toThrow(/PUBLISHING_ASSET_UNAVAILABLE/);
  });
});