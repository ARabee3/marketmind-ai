/**
 * Verifies a `publishing-export-manifest-v1` archive produced by the n8n
 * Manual Export Archive node (Phase 6): recomputes each asset's SHA-256 from
 * the committed demo file referenced by the asset manifest and confirms it
 * matches the export manifest's checksum, then recomputes the export manifest
 * checksum itself. Exits non-zero on any drift.
 *
 * Usage: `npm run verify:export-archive -- <path-to-export-manifest.json>`
 * (from apps/api). If no path is given, reads a manifest from stdin.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ASSET_MANIFEST_PATH = path.resolve(
  process.cwd(),
  "test-assets/publishing/manifest.json",
);

interface ExportManifest {
  readonly contract_version: string;
  readonly intent_id: string;
  readonly candidate_id: string;
  readonly assets: ReadonlyArray<{
    readonly asset_id: string;
    readonly mime_type: string;
    readonly checksum: string;
  }>;
  readonly manifest_checksum: string;
  readonly [k: string]: unknown;
}

function fail(msg: string): never {
  console.error("verify-export-archive: FAIL — " + msg);
  process.exit(1);
}

function main(): void {
  const argPath = process.argv[2];
  const raw = argPath
    ? fs.readFileSync(argPath, "utf8")
    : fs.readFileSync(0, "utf8");
  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    return fail(`manifest is not valid JSON: ${(e as Error).message}`);
  }
  if (manifest.contract_version !== "publishing-export-manifest-v1") {
    return fail(
      `contract_version is "${manifest.contract_version}", expected publishing-export-manifest-v1`,
    );
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    return fail("manifest has no assets");
  }

  const assetManifest = JSON.parse(
    fs.readFileSync(ASSET_MANIFEST_PATH, "utf8"),
  ) as {
    assets: Record<
      string,
      { file: string; mime_type: string; checksum: string }
    >;
  };

  for (const a of manifest.assets) {
    const entry = assetManifest.assets[a.asset_id];
    if (!entry) {
      return fail(`asset ${a.asset_id} not found in committed asset manifest`);
    }
    const bytes = fs.readFileSync(path.join(path.dirname(ASSET_MANIFEST_PATH), entry.file));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== a.checksum) {
      return fail(
        `asset ${a.asset_id} checksum mismatch: manifest=${a.checksum} recomputed=${digest}`,
      );
    }
    if (a.mime_type !== entry.mime_type) {
      return fail(
        `asset ${a.asset_id} mime_type mismatch: manifest=${a.mime_type} committed=${entry.mime_type}`,
      );
    }
  }

  // Recompute the manifest checksum over the canonical payload with
  // manifest_checksum cleared to "" — mirrors how the n8n node stamps it
  // (the key is present but empty, so the canonical JSON matches exactly).
  const recomputed = crypto
    .createHash("sha256")
    .update(JSON.stringify({ ...manifest, manifest_checksum: "" }), "utf8")
    .digest("hex");
  if (recomputed !== manifest.manifest_checksum) {
    return fail(
      `manifest_checksum mismatch: stored=${manifest.manifest_checksum} recomputed=${recomputed}`,
    );
  }

  console.log(
    `verify-export-archive: OK — ${manifest.assets.length} asset(s), checksums match committed bytes, manifest checksum valid (intent ${manifest.intent_id}).`,
  );
}

main();