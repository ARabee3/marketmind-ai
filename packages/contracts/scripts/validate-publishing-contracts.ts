import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ERROR_CODES,
  computePublicationAssetChecksum,
  computePublicationCandidateChecksum,
  computePublicationApprovalFingerprint,
  computePublishingSha256,
  PUBLISHING_ERROR_CODES,
  PUBLICATION_OUTCOMES,
  classifyPublishingReplay,
  publicationAttemptIdempotencyKey,
  publicationAttemptStateForOutcome,
  publicationIntentJobKey,
  publicationIntentStateForOutcome,
  reducePublicationCandidateEventV1,
  requiresPublicationApprovalInvalidation,
  signPublicationDispatchEnvelope,
  validateCandidateForPublishing,
  validateExactPublicationApproval,
  validatePublicationApprovalSnapshotV1,
  validatePublicationAttemptV1,
  validatePublicationCallbackContext,
  validatePublicationDispatchContext,
  validatePublicationIntentV1,
  validatePublicationResultV1,
  validatePublicationScheduleInstant,
  validatePublishingTargetV1,
  validateRetrievedPublicationAssetsV1,
  validateSignedPublicationCallbackEnvelopeV1,
  validateSignedPublicationDispatchEnvelopeV1,
  type PublicationApprovalSnapshotV1,
  type PublicationAttemptV1,
  type PublicationCandidateStatusV1,
  type PublicationCandidateCreatedEventV1,
  type PublicationCandidateRecordV1,
  type PublicationCandidateStateChangedEventV1,
  type PublicationCandidateV1,
  type PublicationIntentV1,
  type SignedPublicationDispatchEnvelopeV1,
  type PublishingEnvelopeValidationContext,
  type PublishingErrorCode,
  type PublishingTargetV1,
  type RetrievedPublicationAssetV1,
} from "../src/index";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const examplesDirectory = resolve(packageDirectory, "examples");
const workflowFixturesDirectory = resolve(
  repositoryDirectory,
  "infra/n8n/fixtures",
);

type JsonObject = Record<string, unknown>;

async function loadJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

async function loadExample(name: string): Promise<JsonObject> {
  return loadJson(resolve(examplesDirectory, name));
}

async function loadWorkflowFixture(name: string): Promise<JsonObject> {
  return loadJson(resolve(workflowFixturesDirectory, name));
}

async function loadWorkflowReference(path: string): Promise<JsonObject> {
  return loadJson(resolve(workflowFixturesDirectory, path));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function firstCode(result: {
  readonly valid: boolean;
  readonly issues: readonly { readonly code: PublishingErrorCode }[];
}): PublishingErrorCode | null {
  return result.valid ? null : (result.issues[0]?.code ?? null);
}

async function materializeContentCandidateDescriptor(name: string): Promise<{
  readonly candidate: PublicationCandidateV1;
  readonly status: PublicationCandidateStatusV1;
}> {
  const descriptor = await loadExample(name);
  const candidate = clone(
    (await loadExample(
      String(descriptor.base_fixture),
    )) as PublicationCandidateV1,
  );
  const defaultStatus = (await loadExample(
    "publication-candidate-status-active.example.json",
  )) as PublicationCandidateStatusV1;
  const mutation = descriptor.mutation as JsonObject | undefined;
  if (mutation?.kind === "unapproved") {
    (candidate.approval as { decision: string }).decision = "rejected";
    (candidate as { candidate_checksum: string }).candidate_checksum =
      computePublicationCandidateChecksum(candidate);
  }
  if (mutation?.kind === "tamper_caption") {
    (candidate as { caption: unknown }).caption = mutation.value;
  }
  if (mutation?.kind === "invalid_asset_checksum") {
    (candidate.assets[0] as { checksum: unknown }).checksum = mutation.value;
    (candidate as { candidate_checksum: string }).candidate_checksum =
      computePublicationCandidateChecksum(candidate);
  }
  return {
    candidate,
    status:
      (descriptor.candidate_status as
        | PublicationCandidateStatusV1
        | undefined) ?? defaultStatus,
  };
}

function recomputeApprovalFingerprint(
  approval: JsonObject,
): PublicationApprovalSnapshotV1 {
  const { approval_fingerprint: _excluded, ...payload } = approval;
  approval.approval_fingerprint = computePublicationApprovalFingerprint(
    payload as Omit<PublicationApprovalSnapshotV1, "approval_fingerprint">,
  );
  return approval as PublicationApprovalSnapshotV1;
}

async function materializeApprovalDescriptor(
  name: string,
): Promise<PublicationApprovalSnapshotV1> {
  const descriptor = await loadExample(name);
  const approval = clone(await loadExample(String(descriptor.base_fixture)));
  const mutation = descriptor.mutation as JsonObject;
  if (mutation.kind === "stale_intent_version") {
    approval.intent_version = mutation.value;
  } else if (mutation.kind === "candidate_mismatch") {
    approval.candidate_id = mutation.value;
  } else if (mutation.kind === "schedule_mismatch") {
    approval.scheduled_utc = mutation.value;
  }
  return recomputeApprovalFingerprint(approval);
}

async function materializeResultDescriptor(name: string): Promise<JsonObject> {
  const descriptor = await loadExample(name);
  const result = clone(await loadExample(String(descriptor.base_fixture)));
  const mutation = descriptor.mutation as JsonObject;
  if (mutation.kind === "mode_confusion") result.mode = mutation.value;
  if (mutation.kind === "remove_simulation_label") {
    result.simulation_label = mutation.value;
  }
  if (mutation.kind === "blind_retry_unknown") {
    result.retryable = mutation.value;
  }
  return result;
}

async function materializeTargetDescriptor(
  name: string,
): Promise<PublishingTargetV1> {
  const descriptor = await loadExample(name);
  const target = clone(await loadExample(String(descriptor.base_fixture)));
  const mutation = descriptor.mutation as JsonObject;
  if (mutation.kind === "expire_target") {
    target.connection_state = mutation.value;
  }
  return target as PublishingTargetV1;
}

async function materializeWorkflowDescriptor(name: string): Promise<{
  readonly envelope: JsonObject;
  readonly seenNonces: ReadonlySet<string>;
}> {
  const descriptor = await loadWorkflowFixture(name);
  const envelope = clone(
    await loadWorkflowFixture(String(descriptor.base_fixture)),
  );
  const mutation = descriptor.mutation as JsonObject;
  const seenNonces = new Set<string>();
  if (mutation.kind === "missing_signature")
    envelope.signature = mutation.value;
  if (mutation.kind === "unknown_key_id") envelope.key_id = mutation.value;
  if (mutation.kind === "expired_timestamp") envelope.sent_at = mutation.value;
  if (mutation.kind === "replayed_nonce") {
    seenNonces.add(String(envelope.nonce));
  }
  if (mutation.kind === "tamper_caption") {
    const body = envelope.body as JsonObject;
    const candidate = body.candidate as JsonObject;
    candidate.caption = mutation.value;
  }
  if (mutation.kind === "invalid_signature")
    envelope.signature = mutation.value;
  if (mutation.kind === "conflicting_replay") {
    const body = envelope.body as JsonObject;
    const result = body.result as JsonObject;
    result.remote_publication_id = mutation.value;
  }
  return { envelope, seenNonces };
}

function envelopeContext(
  envelope: JsonObject,
  secret: string,
  seenNonces: ReadonlySet<string> = new Set(),
  now = String(envelope.sent_at),
): PublishingEnvelopeValidationContext {
  return {
    secret,
    expected_key_id: "fixture-key-v1",
    now,
    seen_nonces: seenNonces,
  };
}

function assertDispatchUsesCanonicalContentFixtures(
  envelope: JsonObject,
  candidate: PublicationCandidateV1,
  status: PublicationCandidateStatusV1,
): void {
  const body = envelope.body as JsonObject;
  assert.deepEqual(
    body.candidate,
    candidate,
    "n8n dispatch candidate must be the canonical Content candidate fixture",
  );
  assert.deepEqual(
    body.candidate_status,
    status,
    "n8n dispatch status must be the canonical Content status fixture",
  );
}

async function validateSingleFile(path: string): Promise<void> {
  const value = await loadJson(resolve(process.cwd(), path));
  const contractVersion = value.contract_version;
  if (contractVersion === "publishing-dispatch-envelope-v1") {
    const manifest = await loadWorkflowFixture(
      "publishing-v1.fixture-manifest.json",
    );
    const candidate = (await loadWorkflowReference(
      String(manifest.canonical_content_candidate),
    )) as PublicationCandidateV1;
    const status = (await loadWorkflowReference(
      String(manifest.canonical_content_status),
    )) as PublicationCandidateStatusV1;
    assertDispatchUsesCanonicalContentFixtures(value, candidate, status);
    const result = validateSignedPublicationDispatchEnvelopeV1(
      value,
      envelopeContext(value, "publishing-v1-fixture-secret-not-for-production"),
    );
    if (!result.valid) throw new Error(result.issues[0]?.code);
  } else if (contractVersion === "publishing-callback-envelope-v1") {
    const result = validateSignedPublicationCallbackEnvelopeV1(
      value,
      envelopeContext(value, "publishing-v1-fixture-secret-not-for-production"),
    );
    if (!result.valid) throw new Error(result.issues[0]?.code);
  } else {
    throw new Error("Unsupported standalone publishing fixture.");
  }
  console.log("Publishing workflow fixture is valid.");
}

async function run(): Promise<void> {
  if (process.argv[2]) {
    await validateSingleFile(process.argv[2]);
    return;
  }

  for (const code of PUBLISHING_ERROR_CODES) {
    assert.equal(ERROR_CODES[code], code, `${code} must be globally exported`);
  }

  const manifest = await loadWorkflowFixture(
    "publishing-v1.fixture-manifest.json",
  );
  assert.equal(
    manifest.contract_version,
    "publishing-workflow-fixture-manifest-v1",
  );
  const fixtureSecret = String(manifest.fixture_secret);
  assert.equal(
    fixtureSecret,
    "publishing-v1-fixture-secret-not-for-production",
  );

  const candidate = (await loadWorkflowReference(
    String(manifest.canonical_content_candidate),
  )) as PublicationCandidateV1;
  const status = (await loadWorkflowReference(
    String(manifest.canonical_content_status),
  )) as PublicationCandidateStatusV1;
  const createdEvent = (await loadWorkflowReference(
    String(manifest.canonical_content_created_event),
  )) as unknown as PublicationCandidateCreatedEventV1;
  assert.deepEqual(
    createdEvent.payload,
    candidate,
    "canonical created event must carry the canonical Content candidate fixture",
  );
  const candidateIntake = reducePublicationCandidateEventV1(
    null,
    createdEvent,
    createdEvent.occurred_at,
  );
  assert.equal(candidateIntake.disposition, "applied");
  assert.ok(candidateIntake.record);
  const candidateRecord =
    candidateIntake.record as PublicationCandidateRecordV1;
  const intent = (await loadExample(
    "publication-intent-real-scheduled.example.json",
  )) as PublicationIntentV1;
  const target = (await loadExample(
    "publishing-target-connected.example.json",
  )) as PublishingTargetV1;
  const approval = (await loadExample(
    "publication-approval-real.example.json",
  )) as PublicationApprovalSnapshotV1;
  const attempt = (await loadExample(
    "publication-attempt-running.example.json",
  )) as PublicationAttemptV1;

  assert.equal(
    firstCode(validateCandidateForPublishing(candidate, status)),
    null,
  );
  assert.equal(firstCode(validatePublishingTargetV1(target)), null);
  const facebookTextTarget = structuredClone(target) as PublishingTargetV1 & {
    capabilities: Array<"static_image" | "text">;
  };
  facebookTextTarget.capabilities = ["static_image", "text"];
  assert.equal(
    firstCode(validatePublishingTargetV1(facebookTextTarget)),
    null,
    "Facebook target may advertise both image and text publishing",
  );
  assert.equal(firstCode(validatePublicationIntentV1(intent)), null);
  assert.equal(
    firstCode(validatePublicationApprovalSnapshotV1(approval)),
    null,
  );
  assert.equal(firstCode(validatePublicationAttemptV1(attempt)), null);
  assert.equal(
    firstCode(
      validateExactPublicationApproval({
        intent,
        candidate,
        status,
        target,
        approval,
      }),
    ),
    null,
  );

  for (const resultFixture of [
    "publication-result-published.example.json",
    "publication-result-exported.example.json",
    "publication-result-simulated.example.json",
    "publication-result-failed.example.json",
    "publication-result-cancelled.example.json",
    "publication-result-unknown.example.json",
  ]) {
    assert.equal(
      firstCode(validatePublicationResultV1(await loadExample(resultFixture))),
      null,
      `${resultFixture} must be valid`,
    );
  }
  const unreachableMediaResult = clone(
    await loadExample("publication-result-failed.example.json"),
  );
  unreachableMediaResult.error_code = "PUBLISHING_MEDIA_ORIGIN_NOT_REACHABLE";
  assert.equal(
    firstCode(validatePublicationResultV1(unreachableMediaResult)),
    null,
    "unreachable media origins must round-trip as a valid failed result code",
  );
  assert.deepEqual(
    [...PUBLICATION_OUTCOMES].sort(),
    [
      "published",
      "exported",
      "simulated",
      "failed",
      "cancelled",
      "unknown",
    ].sort(),
  );
  assert.equal(publicationAttemptStateForOutcome("unknown"), "unknown");
  assert.equal(publicationIntentStateForOutcome("unknown"), "action_required");

  const dispatch = await loadWorkflowFixture(String(manifest.valid_dispatch));
  const callback = await loadWorkflowFixture(String(manifest.valid_callback));
  assertDispatchUsesCanonicalContentFixtures(dispatch, candidate, status);
  assert.equal(
    computePublishingSha256(dispatch.body),
    dispatch.body_sha256,
    "checked-in dispatch canonical body hash must match",
  );
  assert.equal(
    computePublishingSha256(callback.body),
    callback.body_sha256,
    "checked-in callback canonical body hash must match",
  );
  assert.equal(
    firstCode(
      validatePublicationDispatchContext({
        envelope: dispatch,
        intent,
        attempt,
        candidate_record: candidateRecord,
        context: envelopeContext(dispatch, fixtureSecret),
      }),
    ),
    null,
  );

  const canonicalAssetBytes = new TextEncoder().encode(
    String(manifest.canonical_asset_bytes_utf8),
  );
  assert.equal(
    computePublicationAssetChecksum(canonicalAssetBytes),
    candidate.assets[0]?.checksum,
    "canonical Content asset checksum must describe the retrieved fixture bytes",
  );
  const dispatchBody = dispatch.body as unknown as {
    assets: readonly {
      asset_id: string;
      mime_type: string;
      checksum: string;
      retrieval_url: string;
      retrieval_expires_at: string;
    }[];
  };
  const retrievedAssets: readonly RetrievedPublicationAssetV1[] = [
    {
      asset_id: candidate.assets[0]!.asset_id,
      mime_type: candidate.assets[0]!.mime_type,
      bytes: canonicalAssetBytes,
    },
  ];
  assert.equal(
    firstCode(
      validateRetrievedPublicationAssetsV1({
        dispatch: dispatchBody,
        retrieved_assets: retrievedAssets,
      }),
    ),
    null,
    "retrieved asset bytes must match the approved candidate digest before execution",
  );
  assert.equal(
    firstCode(
      validateRetrievedPublicationAssetsV1({
        dispatch: dispatchBody,
        retrieved_assets: [
          {
            ...retrievedAssets[0]!,
            bytes: new TextEncoder().encode(
              `${String(manifest.canonical_asset_bytes_utf8)}-tampered`,
            ),
          },
        ],
      }),
    ),
    "PUBLISHING_ASSET_TAMPERED",
    "retrieved bytes with a mismatched hash must be rejected before dispatch",
  );

  const driftedDispatchBody = clone(dispatch.body) as JsonObject;
  const driftedCandidate = driftedDispatchBody.candidate as JsonObject;
  driftedCandidate.caption =
    "Internally valid, but not the canonical Content fixture.";
  driftedCandidate.candidate_checksum = computePublicationCandidateChecksum(
    driftedCandidate as PublicationCandidateV1,
  );
  const driftedStatus = driftedDispatchBody.candidate_status as JsonObject;
  driftedStatus.candidate_checksum = driftedCandidate.candidate_checksum;
  const driftedApproval = driftedDispatchBody.approval as JsonObject;
  driftedApproval.candidate_checksum = driftedCandidate.candidate_checksum;
  recomputeApprovalFingerprint(driftedApproval);
  const resignedDriftedDispatch = signPublicationDispatchEnvelope(
    {
      contract_version: "publishing-dispatch-envelope-v1",
      message_id: "27272727-2727-4272-8272-272727272727",
      sent_at: String(dispatch.sent_at),
      nonce: "fixture-content-drift-0001",
      key_id: String(dispatch.key_id),
      body: driftedDispatchBody as unknown as SignedPublicationDispatchEnvelopeV1["body"],
    },
    fixtureSecret,
  );
  assert.equal(
    firstCode(
      validateSignedPublicationDispatchEnvelopeV1(
        resignedDriftedDispatch,
        envelopeContext(resignedDriftedDispatch, fixtureSecret),
      ),
    ),
    null,
    "drift proof must remain internally signed and schema-valid",
  );
  assert.throws(
    () =>
      assertDispatchUsesCanonicalContentFixtures(
        resignedDriftedDispatch as unknown as JsonObject,
        candidate,
        status,
      ),
    /canonical Content candidate fixture/,
    "n8n fixture validation must fail when its candidate copy drifts",
  );
  assert.equal(
    firstCode(
      validatePublicationCallbackContext({
        envelope: callback,
        attempt,
        context: envelopeContext(callback, fixtureSecret),
      }),
    ),
    null,
  );

  const inconsistentDispatch = clone(
    dispatch,
  ) as unknown as SignedPublicationDispatchEnvelopeV1;
  const inconsistentBody = clone(inconsistentDispatch.body);
  const inconsistentApproval =
    inconsistentBody.approval as unknown as JsonObject;
  inconsistentApproval.target_id = "25252525-2525-4252-8252-252525252525";
  recomputeApprovalFingerprint(inconsistentApproval);
  const resignedInconsistentDispatch = signPublicationDispatchEnvelope(
    {
      contract_version: "publishing-dispatch-envelope-v1",
      message_id: "26262626-2626-4262-8262-262626262626",
      sent_at: inconsistentDispatch.sent_at,
      nonce: "fixture-approval-mismatch-0001",
      key_id: inconsistentDispatch.key_id,
      body: inconsistentBody,
    },
    fixtureSecret,
  );
  assert.equal(
    firstCode(
      validateSignedPublicationDispatchEnvelopeV1(
        resignedInconsistentDispatch,
        envelopeContext(resignedInconsistentDispatch, fixtureSecret),
      ),
    ),
    "PUBLISHING_STATE_CONFLICT",
    "n8n must reject an authenticated dispatch with mismatched approval bindings",
  );

  assert.equal(
    publicationIntentJobKey(intent.intent_id, intent.version),
    "publishing:intent:13131313-1313-4131-8131-131313131313:v2",
  );
  assert.equal(
    publicationAttemptIdempotencyKey(intent.intent_id, intent.version, 1),
    attempt.idempotency_key,
  );
  assert.equal(
    firstCode(
      validatePublicationScheduleInstant(
        "2026-08-03T15:30:00Z",
        "2026-08-03T15:29:59Z",
      ),
    ),
    null,
  );
  const revokedEvent = (await loadWorkflowReference(
    String(manifest.canonical_content_state_changed_event),
  )) as unknown as PublicationCandidateStateChangedEventV1;
  const revokedIntake = reducePublicationCandidateEventV1(
    candidateRecord,
    revokedEvent,
    revokedEvent.occurred_at,
  );
  assert.equal(revokedIntake.disposition, "applied");
  assert.equal(
    firstCode(
      validatePublicationDispatchContext({
        envelope: dispatch,
        intent,
        attempt,
        candidate_record: revokedIntake.record,
        context: envelopeContext(dispatch, fixtureSecret),
      }),
    ),
    "PUBLISHING_CANDIDATE_REVOKED",
    "latest authoritative revoked v2 must block a stale active v1 dispatch",
  );
  assert.equal(
    firstCode(
      validatePublicationScheduleInstant(
        "2026-08-03T15:30:00Z",
        "2026-08-03T15:30:00Z",
      ),
    ),
    "PUBLISHING_SCHEDULE_IN_PAST",
  );
  assert.equal(requiresPublicationApprovalInvalidation(intent, intent), false);
  assert.equal(
    requiresPublicationApprovalInvalidation(intent, {
      ...intent,
      scheduled_utc: "2026-08-03T15:45:00Z",
    }),
    true,
  );

  for (const [fixtureName, expectedCode] of [
    [
      "publication-candidate-unapproved.invalid.json",
      "PUBLISHING_CANDIDATE_INVALID",
    ],
    [
      "publication-candidate-tampered.invalid.json",
      "PUBLISHING_CANDIDATE_TAMPERED",
    ],
    [
      "publication-candidate-asset-checksum-format.invalid.json",
      "PUBLISHING_CANDIDATE_INVALID",
    ],
    [
      "publication-candidate-revoked.invalid.json",
      "PUBLISHING_CANDIDATE_REVOKED",
    ],
  ] as const) {
    const invalid = await materializeContentCandidateDescriptor(fixtureName);
    assert.equal(
      firstCode(
        validateCandidateForPublishing(invalid.candidate, invalid.status),
      ),
      expectedCode,
      `${fixtureName} must be rejected`,
    );
  }

  for (const fixtureName of [
    "publication-approval-stale.invalid.json",
    "publication-approval-candidate-mismatch.invalid.json",
    "publication-approval-schedule-mismatch.invalid.json",
  ]) {
    const invalidApproval = await materializeApprovalDescriptor(fixtureName);
    assert.equal(
      firstCode(
        validateExactPublicationApproval({
          intent,
          candidate,
          status,
          target,
          approval: invalidApproval,
        }),
      ),
      "PUBLISHING_STATE_CONFLICT",
      `${fixtureName} must invalidate exact approval`,
    );
  }

  const expiredTarget = await materializeTargetDescriptor(
    "publishing-target-expired.invalid.json",
  );
  assert.equal(
    firstCode(
      validateExactPublicationApproval({
        intent,
        candidate,
        status,
        target: expiredTarget,
        approval,
      }),
    ),
    "PUBLISHING_TARGET_UNAUTHORIZED",
  );

  for (const [fixtureName, expectedCode] of [
    [
      "publication-result-mode-confusion.invalid.json",
      "PUBLISHING_CALLBACK_INVALID",
    ],
    [
      "publication-result-simulated-unlabeled.invalid.json",
      "PUBLISHING_CALLBACK_INVALID",
    ],
    [
      "publication-result-unknown-retryable.invalid.json",
      "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
    ],
  ] as const) {
    assert.equal(
      firstCode(
        validatePublicationResultV1(
          await materializeResultDescriptor(fixtureName),
        ),
      ),
      expectedCode,
      `${fixtureName} must preserve truthful result semantics`,
    );
  }

  for (const [fixtureName, expectedCode, kind] of [
    [
      "publishing-dispatch-signature-missing.invalid.json",
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "dispatch",
    ],
    [
      "publishing-dispatch-key-id.invalid.json",
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "dispatch",
    ],
    [
      "publishing-dispatch-timestamp-expired.invalid.json",
      "PUBLISHING_WEBHOOK_TIMESTAMP_INVALID",
      "dispatch",
    ],
    [
      "publishing-dispatch-nonce-replay.invalid.json",
      "PUBLISHING_WEBHOOK_NONCE_REPLAYED",
      "dispatch",
    ],
    [
      "publishing-dispatch-body-tampered.invalid.json",
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "dispatch",
    ],
    [
      "publishing-callback-signature-invalid.invalid.json",
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "callback",
    ],
  ] as const) {
    const invalid = await materializeWorkflowDescriptor(fixtureName);
    const context = envelopeContext(
      invalid.envelope,
      fixtureSecret,
      invalid.seenNonces,
      fixtureName === "publishing-dispatch-timestamp-expired.invalid.json"
        ? "2026-08-03T15:29:30Z"
        : String(invalid.envelope.sent_at),
    );
    const result =
      kind === "dispatch"
        ? validateSignedPublicationDispatchEnvelopeV1(invalid.envelope, context)
        : validateSignedPublicationCallbackEnvelopeV1(
            invalid.envelope,
            context,
          );
    assert.equal(
      firstCode(result),
      expectedCode,
      `${fixtureName} must be rejected before adapter/state mutation`,
    );
  }

  const conflictingCallback = await materializeWorkflowDescriptor(
    "publishing-callback-conflicting-replay.invalid.json",
  );
  const acceptedCallbackFingerprint = computePublishingSha256(callback.body);
  const conflictingCallbackFingerprint = computePublishingSha256(
    conflictingCallback.envelope.body,
  );
  assert.equal(
    classifyPublishingReplay(
      acceptedCallbackFingerprint,
      acceptedCallbackFingerprint,
    ),
    "identical_replay",
  );
  assert.equal(
    classifyPublishingReplay(
      acceptedCallbackFingerprint,
      conflictingCallbackFingerprint,
    ),
    "conflict",
  );

  console.log(
    "publishing-v1 authoritative status, SHA-256 assets, exact approval, idempotency, and canonical signed workflow fixtures are valid.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
