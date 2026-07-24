#!/usr/bin/env node
// allow: SIZE_OK — this standalone authoring CLI intentionally keeps the
// corpus schema, fixture gates, checksum updates, and manifest generation in
// one executable so contributors run and review one authoritative validator.
// Authoring-time validator for the MarketMind marketing knowledge corpus.
//
// Walks every .md entry under Docs/marketing-knowledge/** (excluding _schema/
// and README.md), validates front matter against the schema and taxonomy,
// computes SHA-256 checksums and writes them back into each file, regenerates
// MANIFEST.json, and confirms that three intentional fixtures under
// _schema/fixtures/ are correctly flagged as unavailable-for-live-retrieval.
//
// Exits non-zero on any failure with a per-file error list.

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { resolveSource } from "./source-resolution.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_ROOT = join(__dirname, "..");
const ROOT = join(__dirname, "..", "..", "..");
const SCHEMA_DIR = __dirname;
const FIXTURES_DIR = join(SCHEMA_DIR, "fixtures");
const MANIFEST_PATH = join(KNOWLEDGE_ROOT, "MANIFEST.json");

// --- Controlled vocabularies (must match _schema/TAXONOMY.md exactly) ---
const KIND = new Set([
  "framework",
  "objective_playbook",
  "channel_playbook",
  "benchmark_report",
  "content_strategy_playbook",
  "budget_playbook",
  "measurement_playbook",
  "regional_guidance",
  "sector_note",
  "policy",
]);

const LOCALE = new Set(["ar-EG", "en", "mixed"]);
const MARKETS = new Set(["egypt", "mena", "global"]);
const INDUSTRIES = new Set([
  "retail",
  "hospitality",
  "services",
  "education",
  "healthcare",
  "general",
]);
const OBJECTIVES = new Set([
  "awareness",
  "acquisition",
  "conversion",
  "retention",
  "launch",
]);
const FUNNEL_STAGES = new Set([
  "awareness",
  "consideration",
  "conversion",
  "retention",
  "advocacy",
]);
const CHANNELS = new Set([
  "facebook",
  "instagram",
  "tiktok",
  "google_business_profile",
  "website",
  "delivery_platforms",
]);
const SEASONS = new Set([
  "ramadan",
  "eid_al_fitr",
  "eid_al_adha",
  "back_to_school",
  "summer",
  "winter_holidays",
]);
const BUDGET_MODES = new Set([
  "organic_only",
  "monthly_amount",
  "three_month_amount",
  "scenario_only",
]);
const EVIDENCE_TIER = new Set([
  "verified_benchmark",
  "reviewed_guidance",
  "contextual_note",
]);
const REVIEW_STATUS = new Set(["draft", "approved", "retired", "expired"]);

const REQUIRED_KEYS = [
  "slug",
  "version",
  "kind",
  "title",
  "summary",
  "locale",
  "markets",
  "industries",
  "business_models",
  "objectives",
  "funnel_stages",
  "channels",
  "seasons",
  "budget_modes",
  "evidence_tier",
  "review_status",
  "source_references",
  "effective_at",
  "expires_at",
  "author",
  "reviewer",
  "reviewed_at",
  "checksum",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXPECTED_FIXTURE_PATHS = [
  "_schema/fixtures/fixture-draft-sample.md",
  "_schema/fixtures/fixture-expired-sample.md",
  "_schema/fixtures/fixture-seasonal-null-expiry.invalid.md",
];

const todayISO = () => new Date().toISOString().slice(0, 10);

function isISODate(v) {
  return typeof v === "string" && ISO_DATE.test(v);
}

function normalizeBody(body) {
  return body.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/, "\n");
}

function checksumOf(body) {
  return createHash("sha256").update(normalizeBody(body)).digest("hex");
}

async function walk(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, acc);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      acc.push(p);
    }
  }
  return acc;
}

function relativeFromRoot(p) {
  return relative(KNOWLEDGE_ROOT, p).split(sep).join("/");
}

function validateEntry(file, data, { allowInvalidFixtureSuffix = false } = {}) {
  const errs = [];
  const fm = data;
  const fileName = file.split(sep).pop();
  const slugFromFile =
    allowInvalidFixtureSuffix && fileName.endsWith(".invalid.md")
      ? fileName.replace(/\.invalid\.md$/, "")
      : fileName.replace(/\.md$/, "");

  for (const k of REQUIRED_KEYS) {
    if (!(k in fm)) errs.push(`missing required key "${k}"`);
  }
  if (typeof fm.slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.slug)) {
    errs.push(`slug "${fm.slug}" must be kebab-case`);
  }
  if (fm.slug && fm.slug !== slugFromFile) {
    errs.push(`slug "${fm.slug}" does not match filename "${slugFromFile}"`);
  }
  if (!Number.isInteger(fm.version) || fm.version < 1) {
    errs.push(`version must be a positive integer, got ${fm.version}`);
  }
  if (!KIND.has(fm.kind)) errs.push(`kind "${fm.kind}" not in enum`);
  if (typeof fm.title !== "string" || fm.title.trim() === "") {
    errs.push(`title must be a non-empty string`);
  }
  if (typeof fm.summary !== "string" || fm.summary.trim() === "") {
    errs.push(`summary must be a non-empty string`);
  }
  if (!LOCALE.has(fm.locale)) errs.push(`locale "${fm.locale}" not in enum`);

  for (const [key, set, name] of [
    ["markets", MARKETS, "MARKETS"],
    ["industries", INDUSTRIES, "INDUSTRIES"],
    ["objectives", OBJECTIVES, "OBJECTIVES"],
    ["funnel_stages", FUNNEL_STAGES, "FUNNEL_STAGES"],
    ["channels", CHANNELS, "CHANNELS"],
    ["seasons", SEASONS, "SEASONS"],
    ["budget_modes", BUDGET_MODES, "BUDGET_MODES"],
  ]) {
    if (!Array.isArray(fm[key])) {
      errs.push(`${key} must be an array (use [] if not applicable)`);
      continue;
    }
    for (const v of fm[key]) {
      if (typeof v !== "string" || !set.has(v)) {
        errs.push(`${key} value "${v}" not in ${name} enum`);
      }
    }
  }

  // business_models are free-form recall-only; just require array of strings.
  if (!Array.isArray(fm.business_models)) {
    errs.push(`business_models must be an array`);
  } else {
    for (const v of fm.business_models) {
      if (typeof v !== "string") {
        errs.push(`business_models value "${v}" must be a string`);
      }
    }
  }

  // Global-sources rule: never label a global source as egypt.
  // We can only enforce the structural side: if any source is clearly global
  // we cannot detect it; instead warn if markets includes a global+egypt mix
  // without a contextual entry. Kept as guidance only (not auto-failed).

  if (!EVIDENCE_TIER.has(fm.evidence_tier)) {
    errs.push(`evidence_tier "${fm.evidence_tier}" not in enum`);
  }
  if (!REVIEW_STATUS.has(fm.review_status)) {
    errs.push(`review_status "${fm.review_status}" not in enum`);
  }

  // source_references
  if (!Array.isArray(fm.source_references) || fm.source_references.length === 0) {
    errs.push(`source_references must be a non-empty array`);
  } else {
    for (const r of fm.source_references) {
      if (typeof r !== "string" || r.trim() === "") {
        errs.push(`source_references entry "${r}" must be a non-empty string`);
      }
    }
  }

  // effective_at / expires_at
  if (!isISODate(fm.effective_at)) {
    errs.push(`effective_at "${fm.effective_at}" is not a valid ISO date`);
  }
  if (fm.expires_at !== null) {
    if (!isISODate(fm.expires_at)) {
      errs.push(`expires_at "${fm.expires_at}" must be null or a valid ISO date`);
    } else if (isISODate(fm.effective_at) && fm.expires_at < fm.effective_at) {
      errs.push(`expires_at (${fm.expires_at}) is before effective_at (${fm.effective_at})`);
    }
  }
  if (Array.isArray(fm.seasons) && fm.seasons.length > 0 && !isISODate(fm.expires_at)) {
    errs.push(`seasonal entries require expires_at to be a valid ISO date`);
  }

  // author / reviewer / reviewed_at consistency
  if (typeof fm.author !== "string" || fm.author.trim() === "") {
    errs.push(`author must be a non-empty string (GitHub handle, no @)`);
  }
  if (fm.review_status === "approved") {
    if (typeof fm.reviewer !== "string" || fm.reviewer.trim() === "") {
      errs.push(`review_status approved but reviewer is null/empty`);
    }
    if (!isISODate(fm.reviewed_at)) {
      errs.push(`review_status approved but reviewed_at is not a valid ISO date`);
    }
  } else {
    if (fm.reviewer !== null) {
      errs.push(`review_status "${fm.review_status}" but reviewer is non-null`);
    }
    if (fm.reviewed_at !== null) {
      errs.push(`review_status "${fm.review_status}" but reviewed_at is non-null`);
    }
  }
  if (typeof fm.checksum !== "string") {
    errs.push(`checksum must be a string (leave "" and let the validator fill it)`);
  }

  return errs;
}

async function processFile(file, { writeBack = true, resolveUrls = true }) {
  const raw = await readFile(file, "utf8");
  const parsed = matter(raw);
  const errs = validateEntry(file, parsed.data);

  // duplicate slug detection is done by caller
  const fm = parsed.data;
  const body = parsed.content;
  const expectedChecksum = checksumOf(body);

  // Write back checksum if different.
  if (writeBack && fm.checksum !== expectedChecksum) {
    fm.checksum = expectedChecksum;
    const newRaw = matter.stringify(body, fm);
    await writeFile(file, newRaw, "utf8");
  }
  fm.checksum = expectedChecksum;

  // URL resolution
  if (resolveUrls && errs.length === 0) {
    for (const r of fm.source_references || []) {
      const result = await resolveSource(r);
      if (!result.ok) {
        errs.push(
          `source_reference could not be resolved: "${r}"${
            result.status ? ` (HTTP ${result.status})` : ""
          }${result.error ? ` (${result.error})` : ""}`,
        );
      }
    }
  }
  return { errs, data: { ...fm, checksum: expectedChecksum }, body };
}

async function checkFixtures() {
  const results = [];
  if (!existsSync(FIXTURES_DIR)) {
    return [{ path: "_schema/fixtures/", errs: ["fixtures directory missing"] }];
  }
  const files = await walk(FIXTURES_DIR);
  const fixturePaths = new Set(files.map(relativeFromRoot));
  for (const expectedPath of EXPECTED_FIXTURE_PATHS) {
    if (!fixturePaths.has(expectedPath)) {
      results.push({
        path: expectedPath,
        errs: ["required fixture missing"],
      });
    }
  }
  for (const f of files) {
    const raw = await readFile(f, "utf8");
    const parsed = matter(raw);
    const expectedInvalid = f.endsWith(".invalid.md");
    const errs = validateEntry(f, parsed.data, {
      allowInvalidFixtureSuffix: expectedInvalid,
    });
    const fm = parsed.data;
    if (expectedInvalid) {
      const hasExpectedError = errs.some((e) => /seasonal.*expires_at/i.test(e));
      results.push({
        path: relativeFromRoot(f),
        errs: hasExpectedError
          ? []
          : [
              `expected invalid fixture to produce seasonal expires_at error; got ${
                errs.length ? errs.join("; ") : "no validation errors"
              }`,
            ],
        availability: hasExpectedError ? [`fixture confirmed expected-invalid: ${errs.join("; ")}`] : [],
        data: fm,
      });
      continue;
    }
    // Live-retrieval availability check: must be flagged unavailable if
    // past expires_at OR review_status !== "approved".
    const availability = [];
    if (fm.review_status !== "approved") {
      availability.push(
        `fixture must be unavailable for live retrieval: review_status is "${fm.review_status}"`,
      );
    }
    if (fm.expires_at !== null && isISODate(fm.expires_at) && fm.expires_at < todayISO()) {
      availability.push(
        `fixture must be unavailable for live retrieval: expires_at ${fm.expires_at} is in the past`,
      );
    }
    results.push({
      path: relativeFromRoot(f),
      errs,
      availability,
      data: fm,
    });
  }
  return results;
}

function buildManifest(entries) {
  return {
    generated_at: new Date().toISOString(),
    entry_count: entries.length,
    entries: entries
      .map((e) => ({
        slug: e.data.slug,
        version: e.data.version,
        kind: e.data.kind,
        review_status: e.data.review_status,
        evidence_tier: e.data.evidence_tier,
        locale: e.data.locale,
        tags: {
          markets: e.data.markets,
          industries: e.data.industries,
          channels: e.data.channels,
          objectives: e.data.objectives,
        },
        checksum: `sha256:${e.data.checksum}`,
        effective_at: e.data.effective_at,
        expires_at: e.data.expires_at,
        author: e.data.author,
        reviewer: e.data.reviewer,
        path: e.path,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

async function main() {
  const allFiles = await walk(KNOWLEDGE_ROOT);
  const entryFiles = allFiles.filter((f) => {
    const rel = relative(KNOWLEDGE_ROOT, f).split(sep).join("/");
    return (
      !rel.startsWith("_schema/") &&
      rel !== "README.md" &&
      rel !== "APPROVAL_RECORD.md" &&
      rel !== "LIVE_READINESS.md" &&
      rel !== "MANIFEST.json" &&
      rel !== "seed-retrieval-queries.json"
    );
  });

  const collectedErrors = [];
  const seenSlugs = new Map();
  const entries = [];

  for (const file of entryFiles) {
    const { errs, data } = await processFile(file, {
      writeBack: true,
      resolveUrls: true,
    });
    const rel = relativeFromRoot(file);
    if (errs.length > 0) {
      collectedErrors.push({ path: rel, errs });
    } else {
      if (seenSlugs.has(data.slug)) {
        collectedErrors.push({
          path: rel,
          errs: [
            `duplicate slug "${data.slug}" (already used by ${seenSlugs.get(
              data.slug,
            )})`,
          ],
        });
      } else {
        seenSlugs.set(data.slug, rel);
        entries.push({ path: rel, data });
      }
    }
  }

  // Fixtures
  const fixtureResults = await checkFixtures();
  for (const fx of fixtureResults) {
    if (fx.errs && fx.errs.length) {
      collectedErrors.push({ path: fx.path, errs: fx.errs });
    }
    if (fx.availability && fx.availability.length) {
      // Fixture availability notes are informational; we assert they ARE flagged
      // unavailable, i.e. there must be at least one availability note.
      // No error here — they are expected to be unavailable.
    } else {
      collectedErrors.push({
        path: fx.path,
        errs: ["fixture was expected to be unavailable for live retrieval"],
      });
    }
  }

  if (collectedErrors.length > 0) {
    console.error("\nMarketing knowledge validation failed:");
    for (const { path, errs } of collectedErrors) {
      console.error(`\n  ${path}`);
      for (const e of errs) console.error(`    - ${e}`);
    }
    console.error(`\n${collectedErrors.length} file(s) with errors.\n`);
    process.exitCode = 1;
    return;
  }

  // Write manifest (stable: preserve generated_at and skip rewrite when the
  // entry set is unchanged so re-running with no edits produces no diff).
  const newManifest = buildManifest(entries);
  let wroteManifest = false;
  let manifestChanged = true;
  if (existsSync(MANIFEST_PATH)) {
    let existing;
    try {
      existing = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
      const existingEntries = JSON.stringify(existing.entries);
      const newEntries = JSON.stringify(newManifest.entries);
      if (existingEntries === newEntries) {
        manifestChanged = false;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      manifestChanged = true;
    }
  }
  if (manifestChanged) {
    await mkdir(KNOWLEDGE_ROOT, { recursive: true });
    await writeFile(
      MANIFEST_PATH,
      JSON.stringify(newManifest, null, 2) + "\n",
      "utf8",
    );
    wroteManifest = true;
  }

  console.log(
    `OK: validated ${entries.length} entries; ${fixtureResults.length} fixture(s) confirmed unavailable-for-retrieval; MANIFEST.json ${
      wroteManifest ? "regenerated" : "unchanged (in sync)"
    }.`,
  );
  for (const fx of fixtureResults) {
    for (const a of fx.availability || []) console.log(`  fixture ${fx.path}: ${a}`);
  }
}

main().catch((e) => {
  console.error("Validator crashed:", e);
  process.exitCode = 1;
});
