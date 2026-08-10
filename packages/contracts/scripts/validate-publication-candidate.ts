import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  computePublicationCandidateChecksum,
  reducePublicationCandidateEventV1,
  validateAuthoritativePublicationCandidateV1,
  validatePublicationCandidateHandoff,
  validatePublicationCandidateV1,
  type ContentErrorCode,
  type PublicationCandidateCreatedEventV1,
  type PublicationCandidateRecordV1,
  type PublicationCandidateStateChangedEventV1,
  type PublicationCandidateStatusV1,
  type PublicationCandidateV1,
} from "../src/index";

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
    case "invalid_asset_checksum":
      candidate.assets![0].checksum = mutation.value;
      recomputeChecksum(candidate);
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

function firstPublishingCode(result: {
  readonly valid: boolean;
  readonly issues: readonly { readonly code: string }[];
}): string | null {
  return result.valid ? null : (result.issues[0]?.code ?? null);
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
const approvedTextOnly = structuredClone(approved);
approvedTextOnly.content_format = "text_post";
approvedTextOnly.assets = [];
approvedTextOnly.alt_text = "";
recomputeChecksum(approvedTextOnly);
assert.equal(
  verifyCandidate(approvedTextOnly),
  null,
  "approved text-only candidate must be valid without a fabricated asset",
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
    "publication-candidate-asset-checksum-format.invalid.json",
    "CONTENT_ASSET_REQUIRED",
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

const createdEvent = (await loadExample(
  "publication-candidate-created-event.example.json",
)) as unknown as PublicationCandidateCreatedEventV1;
const createdIntake = reducePublicationCandidateEventV1(
  null,
  createdEvent,
  "2026-08-01T11:01:02+03:00",
);
assert.equal(createdIntake.accepted, true);
assert.equal(createdIntake.changed, true);
assert.equal(createdIntake.disposition, "applied");
assert.ok(createdIntake.record);
const activeRecord = createdIntake.record as PublicationCandidateRecordV1;
assert.equal(activeRecord.source_state, "active");
assert.equal(activeRecord.source_state_version, 1);
assert.equal(
  firstPublishingCode(
    validateAuthoritativePublicationCandidateV1({
      record: activeRecord,
      candidate: approved,
      status: activeStatus,
    }),
  ),
  null,
  "authoritative active v1 state must be executable",
);

const identicalIntake = reducePublicationCandidateEventV1(
  activeRecord,
  createdEvent,
  "2026-08-01T11:01:03+03:00",
);
assert.equal(identicalIntake.accepted, true);
assert.equal(identicalIntake.changed, false);
assert.equal(identicalIntake.disposition, "identical_replay");
assert.strictEqual(
  identicalIntake.record,
  activeRecord,
  "identical replay must be a no-op",
);

const revokedEvent = (await loadExample(
  "publication-candidate-state-changed-event.example.json",
)) as unknown as PublicationCandidateStateChangedEventV1;
const candidatePayloadBeforeTransition = structuredClone(activeRecord.payload);
const revokedIntake = reducePublicationCandidateEventV1(
  activeRecord,
  revokedEvent,
  "2026-08-01T12:00:01+03:00",
);
assert.equal(revokedIntake.accepted, true);
assert.equal(revokedIntake.changed, true);
assert.equal(revokedIntake.disposition, "applied");
assert.ok(revokedIntake.record);
const revokedRecord = revokedIntake.record as PublicationCandidateRecordV1;
assert.equal(revokedRecord.source_state, "revoked");
assert.equal(revokedRecord.source_state_version, 2);
assert.deepEqual(
  revokedRecord.payload,
  candidatePayloadBeforeTransition,
  "candidate payload bytes must remain immutable across status transitions",
);
assert.strictEqual(
  revokedRecord.payload,
  activeRecord.payload,
  "status reducer must reuse the authoritative immutable payload",
);

const identicalRevocation = reducePublicationCandidateEventV1(
  revokedRecord,
  revokedEvent,
  "2026-08-01T12:00:02+03:00",
);
assert.equal(identicalRevocation.disposition, "identical_replay");
assert.equal(identicalRevocation.changed, false);

const staleActiveReplay = reducePublicationCandidateEventV1(
  revokedRecord,
  createdEvent,
  "2026-08-01T12:00:03+03:00",
);
assert.equal(staleActiveReplay.accepted, false);
assert.equal(staleActiveReplay.disposition, "rejected_stale");
assert.equal(
  firstPublishingCode(staleActiveReplay.validation),
  "PUBLISHING_STATE_CONFLICT",
);
assert.equal(
  firstPublishingCode(
    validateAuthoritativePublicationCandidateV1({
      record: revokedRecord,
      candidate: approved,
      status: activeStatus,
    }),
  ),
  "PUBLISHING_CANDIDATE_REVOKED",
  "stale active v1 must never become executable after revoked v2",
);

const conflictingStatusEvent = structuredClone(revokedEvent) as {
  event_id: string;
  payload: { changed_at: string };
};
conflictingStatusEvent.payload.changed_at = "2026-08-01T12:00:05+03:00";
const conflictingStatus = reducePublicationCandidateEventV1(
  revokedRecord,
  conflictingStatusEvent,
  "2026-08-01T12:00:06+03:00",
);
assert.equal(conflictingStatus.accepted, false);
assert.equal(conflictingStatus.disposition, "rejected_conflict");
assert.equal(
  firstPublishingCode(conflictingStatus.validation),
  "PUBLISHING_STATE_CONFLICT",
  "same-version conflicting status must be rejected",
);

const replacedEvent = structuredClone(revokedEvent) as {
  event_id: string;
  payload: {
    candidate_state: "replaced";
    replacement_candidate_id: string;
  };
};
replacedEvent.event_id = "abababab-abab-4aba-8aba-abababababab";
replacedEvent.payload.candidate_state = "replaced";
replacedEvent.payload.replacement_candidate_id =
  "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc";
const replacedIntake = reducePublicationCandidateEventV1(
  activeRecord,
  replacedEvent,
  "2026-08-01T12:00:07+03:00",
);
assert.equal(replacedIntake.disposition, "applied");
assert.equal(
  firstPublishingCode(
    validateAuthoritativePublicationCandidateV1({
      record: replacedIntake.record,
      candidate: approved,
      status: activeStatus,
    }),
  ),
  "PUBLISHING_CANDIDATE_REVOKED",
  "stale active v1 must never become executable after replaced v2",
);

console.log(
  "Publication candidate schema, SHA-256 assets, authoritative status intake, revocation, and replay rules are valid.",
);
