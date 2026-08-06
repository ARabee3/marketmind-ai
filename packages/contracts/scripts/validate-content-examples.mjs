import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const examplesUrl = new URL("../examples/", import.meta.url);
const validExamples = [
  "content-cycle.example.json",
  "content-week-context-owner-promotion.example.json",
  "content-week-context-safe-default.example.json",
  "content-pack-week-1-ar.example.json",
  "content-pack-week-1-en.example.json",
  "content-pack-week-1-mixed.example.json",
  "content-pack-week-1-tiktok.example.json",
  "content-pack-week-1-gbp.example.json",
  "content-pack-week-2-rollover.example.json",
  "content-item-version-owner-asset.example.json",
  "content-item-version-generated-asset.example.json",
  "content-item-version-prompt-only.example.json",
  "content-decision-approved.example.json",
  "publication-candidate-approved.example.json",
  "publication-candidate-status-active.example.json",
  "publication-candidate-created-event.example.json",
  "publication-candidate-state-changed-event.example.json",
];
const invalidExamples = [
  "content-week-13.invalid.json",
  "content-duplicate-week-claim.invalid.json",
  "content-strategy-unapproved.invalid.json",
  "content-profile-stale.invalid.json",
  "content-invented-promotion.invalid.json",
  "content-expired-promotion.invalid.json",
  "content-wrong-channel.invalid.json",
  "content-unsupported-testimonial.invalid.json",
  "content-guarantee-claim.invalid.json",
  "content-regulated-claim.invalid.json",
  "content-competitor-superiority.invalid.json",
  "content-unconfirmed-price.invalid.json",
  "content-unconfirmed-availability.invalid.json",
  "content-superiority-claim.invalid.json",
  "content-branded-undisclosed.invalid.json",
  "content-protected-text-mutated.invalid.json",
  "content-default-context-owner-claim.invalid.json",
  "content-missing-required-asset.invalid.json",
  "content-empty-alt-text.invalid.json",
  "content-alt-text-too-long.invalid.json",
  "content-cycle-paused.invalid.json",
  "content-cycle-completed.invalid.json",
  "content-schema-failure.invalid.json",
  "content-pack-too-few-items.invalid.json",
  "content-pack-too-many-items.invalid.json",
  "content-provider-failure.invalid.json",
  "content-approval-blocked.invalid.json",
  "content-version-conflict.invalid.json",
  "content-pack-strategy-version-mismatch.invalid.json",
  "content-trace-week-mismatch.invalid.json",
  "content-item-pack-mismatch.invalid.json",
  "content-trace-channel-mismatch.invalid.json",
  "content-asset-owner-mismatch.invalid.json",
  "content-decision-item-mismatch.invalid.json",
  "publication-candidate-prompt-only.invalid.json",
  "publication-candidate-unapproved.invalid.json",
  "publication-candidate-tampered.invalid.json",
  "publication-candidate-revoked.invalid.json",
  "publication-candidate-replay-conflict.invalid.json",
  "publication-candidate-replay-identical.invalid.json",
];

const argvFile = process.argv[2];
if (argvFile) {
  const parsed = JSON.parse(
    await readFile(new URL(`file://${process.cwd()}/${argvFile}`), "utf8"),
  );
  const issues = [];
  if (
    Number.isInteger(parsed.week_number) &&
    (parsed.week_number < 1 || parsed.week_number > 12)
  ) {
    issues.push("CONTENT_WEEK_OUT_OF_RANGE");
  }
  if (
    parsed.asset_required === true &&
    typeof parsed.alt_text === "string" &&
    !parsed.alt_text.trim()
  ) {
    issues.push("CONTENT_ASSET_REQUIRED");
  }
  if (issues.length > 0) {
    console.log(issues.join(", "));
    process.exit(1);
  }
  console.log("Valid content-v1 document surface.");
  process.exit(0);
}

for (const name of [...validExamples, ...invalidExamples]) {
  const parsed = JSON.parse(await readFile(new URL(name, examplesUrl), "utf8"));
  assert(
    parsed !== null && typeof parsed === "object",
    `${name} must contain JSON`,
  );
}

console.log(
  `Content fixture inventory is complete (${validExamples.length} valid, ${invalidExamples.length} invalid).`,
);
