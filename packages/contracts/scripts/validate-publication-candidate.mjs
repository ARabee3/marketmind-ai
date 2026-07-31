import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const examplesUrl = new URL("../examples/", import.meta.url);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function checksum(candidate) {
  const { candidate_checksum: _excluded, ...payload } = candidate;
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

async function load(name) {
  return JSON.parse(await readFile(new URL(name, examplesUrl), "utf8"));
}

function verifyCandidate(candidate) {
  const valid = checksum(candidate) === candidate.candidate_checksum;
  if (candidate.candidate_state === "revoked") {
    return "CONTENT_CANDIDATE_REVOKED";
  }
  if (!valid) {
    return "CONTENT_CANDIDATE_TAMPERED";
  }
  return null;
}

const argvFile = process.argv[2];
if (argvFile) {
  const candidate = await load(new URL(`file://${process.cwd()}/${argvFile}`));
  const code = verifyCandidate(candidate);
  if (code) {
    console.log(code);
    process.exit(1);
  }
  console.log("Publication candidate checksum is valid.");
  process.exit(0);
}

const approved = await load("publication-candidate-approved.example.json");
assert.equal(checksum(approved), approved.candidate_checksum);
assert.equal(approved.candidate_state, "active");
for (const forbidden of ["prompt", "profile", "provider", "target_account", "schedule", "publish_status"]) {
  assert(!(forbidden in approved), `candidate must exclude ${forbidden}`);
}

function mutate(base, testCase) {
  const candidate = structuredClone(base);
  switch (testCase.mutation.kind) {
    case "tamper_caption":
      candidate.caption = testCase.mutation.value;
      return candidate;
    case "tamper_asset_checksum":
      candidate.assets[0].checksum = testCase.mutation.value;
      return candidate;
    case "tamper_target_channel":
      candidate.target_channel = testCase.mutation.value;
      return candidate;
    case "tamper_approval_id":
      candidate.approval.decision_id = testCase.mutation.value;
      return candidate;
    case "tamper_item_version":
      candidate.content_item_version = testCase.mutation.value;
      return candidate;
    case "revoked":
      candidate.candidate_state = "revoked";
      return candidate;
    case "replay_conflict":
      candidate.caption = testCase.mutation.value;
      candidate.candidate_checksum = testCase.mutation.candidate_checksum;
      return candidate;
    case "replay_identical":
      candidate.candidate_checksum = checksum(candidate);
      return candidate;
    case "prompt_only_asset":
      candidate.assets[0].kind = "prompt_only";
      return candidate;
    case "unapproved":
      candidate.approval.decision = "rejected";
      return candidate;
    default:
      throw new Error("Unsupported publication candidate mutation.");
  }
}

async function loadInvalid(name) {
  return mutate(approved, await load(name));
}

for (const [name, expectedCode] of [
  ["publication-candidate-tampered.invalid.json", "CONTENT_CANDIDATE_TAMPERED"],
  ["publication-candidate-asset-tampered.invalid.json", "CONTENT_CANDIDATE_TAMPERED"],
  ["publication-candidate-channel-tampered.invalid.json", "CONTENT_CANDIDATE_TAMPERED"],
  ["publication-candidate-approval-tampered.invalid.json", "CONTENT_CANDIDATE_TAMPERED"],
  ["publication-candidate-version-tampered.invalid.json", "CONTENT_CANDIDATE_TAMPERED"],
  ["publication-candidate-replay-conflict.invalid.json", "CONTENT_CANDIDATE_TAMPERED"],
  ["publication-candidate-revoked.invalid.json", "CONTENT_CANDIDATE_REVOKED"],
]) {
  const candidate = await loadInvalid(name);
  const code = verifyCandidate(candidate);
  assert.equal(code, expectedCode, `${name}: expected ${expectedCode}, got ${code}`);
}

const replay = await loadInvalid("publication-candidate-replay-conflict.invalid.json");
assert.equal(replay.candidate_id, approved.candidate_id);

const identicalReplay = await loadInvalid("publication-candidate-replay-identical.invalid.json");
assert.equal(verifyCandidate(identicalReplay), null, "identical replay must be idempotent");

const promptOnly = await loadInvalid("publication-candidate-prompt-only.invalid.json");
assert.equal(promptOnly.assets[0].kind, "prompt_only");
const unapproved = await loadInvalid("publication-candidate-unapproved.invalid.json");
assert.notEqual(unapproved.approval.decision, "approved");

console.log("Publication candidate checksum, boundary, tamper, revocation, and replay rules are valid.");
