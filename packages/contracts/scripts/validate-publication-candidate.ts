import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  computePublicationCandidateChecksum,
  validatePublicationCandidateHandoff,
  validatePublicationCandidateV1,
  type ContentErrorCode,
  type PublicationCandidateStatusV1,
  type PublicationCandidateV1,
} from "../src/content/index";

const examplesUrl = new URL("../examples/", import.meta.url);

type CandidateDocument = Record<string, unknown> & {
  assets?: Array<Record<string, unknown>>;
  approval?: Record<string, unknown>;
};

type CandidateDescriptor = {
  readonly base_fixture: string;
  readonly mutation?: {
    readonly kind: string;
    readonly value?: unknown;
    readonly candidate_checksum?: string;
  };
  readonly candidate_status?: PublicationCandidateStatusV1;
};

async function loadJson(path: URL | string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function loadExample(name: string): Promise<CandidateDocument> {
  return loadJson(new URL(name, examplesUrl));
}

function recomputeChecksum(candidate: CandidateDocument): void {
  candidate.candidate_checksum = computePublicationCandidateChecksum(
    candidate as PublicationCandidateV1,
  );
}

function mutateCandidate(
  base: CandidateDocument,
  descriptor: CandidateDescriptor,
): CandidateDocument {
  const candidate = structuredClone(base);
  const mutation = descriptor.mutation;
  if (!mutation) return candidate;

  switch (mutation.kind) {
    case "tamper_caption":
      candidate.caption = mutation.value;
      return candidate;
    case "tamper_asset_checksum":
      candidate.assets![0].checksum = mutation.value;
      return candidate;
    case "tamper_target_channel":
      candidate.target_channel = mutation.value;
      return candidate;
    case "tamper_approval_id":
      candidate.approval!.decision_id = mutation.value;
      return candidate;
    case "tamper_item_version":
      candidate.content_item_version = mutation.value;
      return candidate;
    case "replay_conflict":
      candidate.caption = mutation.value;
      candidate.candidate_checksum = mutation.candidate_checksum;
      return candidate;
    case "replay_identical":
      recomputeChecksum(candidate);
      return candidate;
    case "prompt_only_asset":
      candidate.assets![0].kind = "prompt_only";
      recomputeChecksum(candidate);
      return candidate;
    case "unapproved":
      candidate.approval!.decision = "rejected";
      recomputeChecksum(candidate);
      return candidate;
    default:
      throw new Error(
        `Unsupported publication candidate mutation: ${mutation.kind}`,
      );
  }
}

async function materializeDescriptor(descriptor: CandidateDescriptor): Promise<{
  candidate: CandidateDocument;
  status?: PublicationCandidateStatusV1;
}> {
  const candidate = mutateCandidate(
    await loadExample(descriptor.base_fixture),
    descriptor,
  );
  return { candidate, status: descriptor.candidate_status };
}

function verifyCandidate(
  candidate: CandidateDocument,
  status?: PublicationCandidateStatusV1,
): ContentErrorCode | null {
  const result = status
    ? validatePublicationCandidateHandoff(candidate, status)
    : validatePublicationCandidateV1(candidate);
  if (!result.valid) return result.issues[0].code;
  return null;
}

const argvFile = process.argv[2];
if (argvFile) {
  const parsed = await loadJson(resolve(process.cwd(), argvFile));
  const materialized =
    "base_fixture" in parsed
      ? await materializeDescriptor(parsed as CandidateDescriptor)
      : { candidate: parsed as CandidateDocument };
  const code = verifyCandidate(materialized.candidate, materialized.status);
  if (code) {
    console.log(code);
    process.exit(1);
  }
  console.log("Publication candidate boundary is valid.");
  process.exit(0);
}

const approved = await loadExample(
  "publication-candidate-approved.example.json",
);
assert.equal(
  verifyCandidate(approved),
  null,
  "approved candidate must be valid",
);
const activeStatus = (await loadExample(
  "publication-candidate-status-active.example.json",
)) as PublicationCandidateStatusV1;
assert.equal(
  verifyCandidate(approved, activeStatus),
  null,
  "approved active candidate handoff must be valid",
);

for (const [name, expectedCode] of [
  ["publication-candidate-tampered.invalid.json", "CONTENT_CANDIDATE_TAMPERED"],
  [
    "publication-candidate-asset-tampered.invalid.json",
    "CONTENT_CANDIDATE_TAMPERED",
  ],
  [
    "publication-candidate-channel-tampered.invalid.json",
    "CONTENT_CANDIDATE_TAMPERED",
  ],
  [
    "publication-candidate-approval-tampered.invalid.json",
    "CONTENT_CANDIDATE_TAMPERED",
  ],
  [
    "publication-candidate-version-tampered.invalid.json",
    "CONTENT_CANDIDATE_TAMPERED",
  ],
  [
    "publication-candidate-replay-conflict.invalid.json",
    "CONTENT_CANDIDATE_TAMPERED",
  ],
  ["publication-candidate-prompt-only.invalid.json", "CONTENT_ASSET_REQUIRED"],
  ["publication-candidate-unapproved.invalid.json", "CONTENT_APPROVAL_BLOCKED"],
  ["publication-candidate-revoked.invalid.json", "CONTENT_CANDIDATE_REVOKED"],
] as const) {
  const descriptor = (await loadExample(name)) as CandidateDescriptor;
  const { candidate, status } = await materializeDescriptor(descriptor);
  const code = verifyCandidate(candidate, status);
  assert.equal(
    code,
    expectedCode,
    `${name}: expected ${expectedCode}, got ${code}`,
  );
}

const replayDescriptor = (await loadExample(
  "publication-candidate-replay-identical.invalid.json",
)) as CandidateDescriptor;
const replay = await materializeDescriptor(replayDescriptor);
assert.equal(
  verifyCandidate(replay.candidate, replay.status),
  null,
  "identical replay must be idempotent",
);
assert.equal(replay.candidate.candidate_id, approved.candidate_id);

console.log(
  "Publication candidate schema, checksum, approval, asset, revocation, and replay rules are valid.",
);
