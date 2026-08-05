import type { PublicationCandidateV1 } from "@marketmind/contracts";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";

import { ManualExportArchiveService } from "../manual-export-archive.service";

function readTarEntries(archive: Buffer): Map<string, Buffer> {
  const tar = zlib.gunzipSync(archive);
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeText, 8);
    const bodyStart = offset + 512;
    entries.set(name, tar.subarray(bodyStart, bodyStart + size));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

describe("ManualExportArchiveService", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketmind-export-test-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("stores a checksum-addressed archive containing the approved copy and exact media", () => {
    const media = Buffer.from("approved-image-bytes", "utf8");
    const mediaChecksum = crypto
      .createHash("sha256")
      .update(media)
      .digest("hex");
    const assetId = "11111111-1111-4111-8111-111111111111";
    const candidate = {
      contract_version: "publication-candidate-v1",
      candidate_id: "22222222-2222-4222-8222-222222222222",
      business_id: "33333333-3333-4333-8333-333333333333",
      content_item_id: "44444444-4444-4444-8444-444444444444",
      content_item_version_id: "55555555-5555-4555-8555-555555555555",
      content_item_version: 7,
      target_channel: "facebook",
      content_format: "static_image_post",
      selected_locale: "ar",
      caption: "النص المعتمد",
      hashtags: ["#تجربة", "#MarketMind"],
      alt_text: "وصف الصورة",
      assets: [
        {
          asset_id: assetId,
          mime_type: "image/png",
          checksum: mediaChecksum,
        },
      ],
      recommended_publish_window: {
        starts_at: "2026-08-06T09:00:00.000Z",
        ends_at: "2026-08-06T10:00:00.000Z",
        timezone: "Africa/Cairo",
      },
      candidate_checksum: "a".repeat(64),
    } as unknown as PublicationCandidateV1;
    const assetStore = {
      getAsset: jest.fn().mockReturnValue({
        id: assetId,
        mimeType: "image/png",
        checksum: mediaChecksum,
        bytes: media,
      }),
    };
    const service = new ManualExportArchiveService(
      { get: jest.fn().mockReturnValue(rootDir) } as any,
      assetStore as any,
    );
    const artifactId = "66666666-6666-4666-8666-666666666666";

    const created = service.createArchive({
      artifactId,
      intentId: "77777777-7777-4777-8777-777777777777",
      candidate,
      generatedAt: new Date("2026-08-05T12:00:00.000Z"),
    });
    const read = service.readArchive(created.destinationRef, created.checksum);
    const entries = readTarEntries(read.bytes);

    expect(crypto.createHash("sha256").update(read.bytes).digest("hex")).toBe(
      created.checksum,
    );
    expect([...entries.keys()]).toEqual([
      "manifest.json",
      "caption-ar.txt",
      "hashtags.txt",
      "alt-text.txt",
      "posting-notes.txt",
      "README.txt",
      `media/${assetId}.png`,
    ]);
    expect(entries.get("caption-ar.txt")?.toString("utf8")).toBe(
      "النص المعتمد\n",
    );
    expect(entries.get(`media/${assetId}.png`)).toEqual(media);

    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
    expect(manifest).toMatchObject({
      contract_version: "publishing-export-manifest-v1",
      artifact_id: artifactId,
      intent_id: "77777777-7777-4777-8777-777777777777",
      candidate_id: candidate.candidate_id,
      candidate_checksum: candidate.candidate_checksum,
      target_channel: candidate.target_channel,
      content_format: candidate.content_format,
      selected_locale: candidate.selected_locale,
      label: "EXPORTED_NOT_PUBLISHED",
      assets: [
        {
          asset_id: assetId,
          archive_path: `media/${assetId}.png`,
          mime_type: "image/png",
          checksum: mediaChecksum,
        },
      ],
    });
    const manifestChecksum = crypto
      .createHash("sha256")
      .update(JSON.stringify({ ...manifest, manifest_checksum: "" }))
      .digest("hex");
    expect(manifest.manifest_checksum).toBe(manifestChecksum);
    // The frozen manifest is also returned by createArchive for persistence,
    // so GET /export can surface it without re-parsing the tar.gz.
    expect(created.manifest).toEqual(manifest);
  });
});
