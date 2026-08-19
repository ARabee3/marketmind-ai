import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateOptimizationProposalV1,
  validateMetricSnapshotV1,
  validatePerformanceOverviewV1,
  validatePerformanceSyncWindowV1,
} from "../src/performance";

const examples = (name: string) => resolve(process.cwd(), "examples", name);

async function load(name: string): Promise<unknown> {
  return JSON.parse(await readFile(examples(name), "utf8"));
}

async function assertValid(
  name: string,
  validate: (value: unknown) => { valid: boolean },
): Promise<unknown> {
  const value = await load(name);
  assert.equal(validate(value).valid, true, `${name} must be valid`);
  return value;
}

async function assertInvalid(
  name: string,
  validate: (value: unknown) => { valid: boolean },
): Promise<void> {
  const value = await load(name);
  assert.equal(validate(value).valid, false, `${name} must be invalid`);
}

const snapshot = await assertValid(
  "performance-snapshot.example.json",
  validateMetricSnapshotV1,
);
assert.equal(
  (snapshot as { metrics: { post_media_view: { value: number } } }).metrics
    .post_media_view.value,
  0,
  "available zero must remain zero",
);
assert.equal(
  (
    snapshot as {
      metrics: { post_total_media_view_unique: { status: string } };
    }
  ).metrics.post_total_media_view_unique.status,
  "unavailable",
);

await assertValid(
  "performance-sync-window.example.json",
  validatePerformanceSyncWindowV1,
);
await assertValid(
  "performance-overview.example.json",
  validatePerformanceOverviewV1,
);
const optimizationProposal = await assertValid(
  "optimization-proposal.example.json",
  validateOptimizationProposalV1,
);
assert.equal(
  validateOptimizationProposalV1({
    ...(optimizationProposal as Record<string, unknown>),
    rationale:
      "This proves the hook causes higher clicks and will increase sales.",
  }).valid,
  false,
  "optimization-v1 must reject unsupported causal claims",
);
assert.equal(
  validateOptimizationProposalV1({
    ...(optimizationProposal as Record<string, unknown>),
    uncertainty:
      "This is not statistically significant and does not guarantee results.",
  }).valid,
  true,
  "optimization-v1 must allow explicit uncertainty disclaimers",
);
assert.equal(
  validateOptimizationProposalV1({
    ...(optimizationProposal as Record<string, unknown>),
    instruction: "نوصي بتغيير الموضوع في المنشور القادم.",
  }).valid,
  false,
  "optimization-v1 must reject Arabic directives outside hook or CTA wording",
);

await assertInvalid(
  "performance-snapshot-negative-value.invalid.json",
  validateMetricSnapshotV1,
);
await assertInvalid(
  "performance-snapshot-coerced-value.invalid.json",
  validateMetricSnapshotV1,
);
await assertInvalid(
  "performance-snapshot-sensitive-metadata.invalid.json",
  validateMetricSnapshotV1,
);
await assertInvalid(
  "performance-sync-window-unknown-state.invalid.json",
  validatePerformanceSyncWindowV1,
);
await assertInvalid(
  "optimization-proposal-unsupported-kind.invalid.json",
  validateOptimizationProposalV1,
);

console.log(
  "performance-v1 and optimization-v1 contract examples and zero/unavailable rules are valid.",
);
