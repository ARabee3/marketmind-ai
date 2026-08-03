/**
 * CallbacksController — frozen `SignedPublicationCallbackEnvelopeV1` boundary.
 *
 * P1 (#119 review): these tests drive the real controller with real signed
 * envelopes (built via `signPublicationCallbackEnvelope`) and validate every
 * callback through the frozen `validatePublicationCallbackContext` over a
 * stored attempt — no custom HMAC/body mirrors, no mocked validator. They
 * cover the three delivery-safety gaps the reviewer called out:
 *   - route ↔ signed `attempt_id` rebinding,
 *   - request-fingerprint drift (callback for a different accepted attempt),
 *   - conflicting vs identical subsequent callbacks,
 *   - signature/timestamp tamper (via the frozen envelope validator).
 */

import * as crypto from "crypto";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CallbacksController } from "../callbacks.controller";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import {
  computeCallbackFingerprint,
  signPublicationCallbackEnvelope,
  type PublicationCallbackBodyV1,
  type PublicationResultV1,
  type SignedPublicationCallbackEnvelopeV1,
} from "@marketmind/contracts";

const SECRET = "test-signing-secret-32chars-long!!";
const KEY_ID = "kid-1";
const ATTEMPT_ID = "11111110-0000-4000-8000-0000000000a1";
const INTENT_ID = "11111110-0000-4000-8000-0000000000b1";
const REQUEST_FINGERPRINT = crypto
  .createHash("sha256")
  .update("dispatch-body")
  .digest("hex");

function publishedResult(): PublicationResultV1 {
  return {
    contract_version: "publication-result-v1",
    result_id: crypto.randomUUID(),
    attempt_id: ATTEMPT_ID,
    intent_id: INTENT_ID,
    intent_version: 1,
    occurred_at: new Date().toISOString(),
    mode: "real",
    outcome: "published",
    provider: "meta",
    remote_publication_id: "ig-media-123",
    remote_url: null,
    export_artifact_id: null,
    simulation_reference_id: null,
    simulation_label: null,
    error_code: null,
    retryable: false,
    reconciliation_required: false,
  } as unknown as PublicationResultV1;
}

function callbackBody(
  overrides: Partial<PublicationCallbackBodyV1> = {},
): PublicationCallbackBodyV1 {
  return {
    contract_version: "publication-callback-v1",
    callback_id: crypto.randomUUID(),
    attempt_id: ATTEMPT_ID,
    intent_id: INTENT_ID,
    intent_version: 1,
    request_fingerprint: REQUEST_FINGERPRINT,
    workflow_version: "v1",
    result: publishedResult(),
    ...overrides,
  } as PublicationCallbackBodyV1;
}

function signEnvelope(
  body: PublicationCallbackBodyV1,
  secret = SECRET,
): SignedPublicationCallbackEnvelopeV1 {
  return signPublicationCallbackEnvelope(
    {
      contract_version: "publishing-callback-envelope-v1",
      message_id: crypto.randomUUID(),
      sent_at: new Date().toISOString(),
      nonce: crypto.randomUUID() + crypto.randomUUID(),
      key_id: KEY_ID,
      body,
    },
    secret,
  );
}

/** The stored attempt row the controller projects to PublicationAttemptV1. */
function storedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    intentId: INTENT_ID,
    intentVersion: 1,
    attemptSequence: 1,
    status: "DISPATCHING",
    workflowVersion: "v1",
    providerRequestFingerprint: REQUEST_FINGERPRINT,
    idempotencyKey: "key-1::dispatch",
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    intent: { id: INTENT_ID, businessId: "b-1" },
    ...overrides,
  };
}

function buildController(prisma: jest.Mocked<Partial<PrismaService>>) {
  const config = {
    get: (k: string) =>
      k === "publishing.n8nSigningSecret"
        ? SECRET
        : k === "publishing.n8nSigningKeyId"
          ? KEY_ID
          : "",
  } as unknown as ConfigService;
  const controller = new CallbacksController(
    prisma as unknown as PrismaService,
    config,
  );
  jest.spyOn(controller["logger"], "log").mockImplementation(() => {});
  jest.spyOn(controller["logger"], "warn").mockImplementation(() => {});
  jest.spyOn(controller["logger"], "error").mockImplementation(() => {});
  return controller;
}

/** Mocks the prisma $transaction and the publishing* DelegatesFiltered
 * clients so that the controller reads the supplied stored attempt. */
function wirePrisma(attempt: ReturnType<typeof storedAttempt>) {
  const callbackCreate = jest.fn();
  const callbackFindUnique = jest.fn().mockResolvedValue(null);
  const resultFindUnique = jest.fn().mockResolvedValue(null);
  const resultCreate = jest.fn().mockResolvedValue({});
  const attemptUpdate = jest.fn().mockResolvedValue({});
  const intentUpdate = jest.fn().mockResolvedValue({});
  const latestFindFirst = jest.fn().mockResolvedValue({ id: attempt.id });

  const prisma: jest.Mocked<Partial<PrismaService>> = {
    publishingAttempt: {
      findUnique: jest.fn().mockResolvedValue(attempt),
      findFirst: latestFindFirst,
      update: attemptUpdate,
    } as any,
    publishingResult: {
      findUnique: resultFindUnique,
      create: resultCreate,
    } as any,
    publishingIntent: { update: intentUpdate } as any,
    publishingCallbackIdentity: {
      create: callbackCreate,
      findUnique: callbackFindUnique,
    } as any,
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(prisma)),
  } as any;
  return {
    prisma,
    callbackCreate,
    callbackFindUnique,
    resultFindUnique,
    resultCreate,
    attemptUpdate,
    intentUpdate,
    latestFindFirst,
  };
}

describe("CallbacksController — frozen signed envelope (P1 #119)", () => {
  it("accepts a valid signed callback and transitions attempt+intent to SUCCEEDED", async () => {
    const attempt = storedAttempt();
    const { prisma, resultCreate, attemptUpdate, intentUpdate } =
      wirePrisma(attempt);
    const controller = buildController(prisma);

    const envelope = signEnvelope(callbackBody());

    await controller.handleCallback(ATTEMPT_ID, envelope);

    expect(resultCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: "PUBLISHED",
          provider: "meta",
          remotePublicationId: "ig-media-123",
          rawPayloadHash: computeCallbackFingerprint(
            (envelope as SignedPublicationCallbackEnvelopeV1).body,
          ),
        }),
      }),
    );
    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ATTEMPT_ID },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
    expect(intentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INTENT_ID },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });

  it("rejects a callback whose signed attempt_id does not match the route attemptId (rebinding)", async () => {
    const attempt = storedAttempt();
    const { prisma, resultCreate } = wirePrisma(attempt);
    const controller = buildController(prisma);

    const envelope = signEnvelope(
      callbackBody({
        attempt_id: crypto.randomUUID() as never,
      }),
    );

    await expect(
      controller.handleCallback(ATTEMPT_ID, envelope),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resultCreate).not.toHaveBeenCalled();
  });

  it("rejects a callback whose signature was made with a different secret (tamper)", async () => {
    const attempt = storedAttempt();
    const { prisma, resultCreate } = wirePrisma(attempt);
    const controller = buildController(prisma);

    // Sign with the WRONG secret; the frozen validator rejects the signature.
    const envelope = signEnvelope(callbackBody(), "wrong-secret");

    await expect(
      controller.handleCallback(ATTEMPT_ID, envelope),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resultCreate).not.toHaveBeenCalled();
  });

  it("rejects a callback whose request_fingerprint does not bind the stored attempt (drift)", async () => {
    // Stored attempt accepted a DIFFERENT dispatch body_sha256.
    const attempt = storedAttempt({
      providerRequestFingerprint: crypto
        .createHash("sha256")
        .update("different-dispatch")
        .digest("hex"),
    });
    const { prisma, resultCreate, intentUpdate } = wirePrisma(attempt);
    const controller = buildController(prisma);

    const envelope = signEnvelope(callbackBody()); // request_fingerprint mismatch

    await expect(
      controller.handleCallback(ATTEMPT_ID, envelope),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(resultCreate).not.toHaveBeenCalled();
    expect(intentUpdate).not.toHaveBeenCalled();
  });

  it("treats an identical callback_id replay as a 200 no-op (no result, no status mutation)", async () => {
    const attempt = storedAttempt();
    const { prisma, callbackCreate, resultCreate, attemptUpdate } =
      wirePrisma(attempt);
    const controller = buildController(prisma);

    const body = callbackBody();
    const fingerprint = computeCallbackFingerprint(body);
    // First create loses the unique-index race; re-read matches our fingerprint.
    callbackCreate.mockRejectedValue({ code: "P2002" } as never);
    (
      prisma.publishingCallbackIdentity!.findUnique as jest.Mock
    ).mockResolvedValue({ payloadHash: fingerprint } as never);

    await expect(
      controller.handleCallback(ATTEMPT_ID, signEnvelope(body)),
    ).resolves.toEqual({ ok: true });
    expect(resultCreate).not.toHaveBeenCalled();
    expect(attemptUpdate).not.toHaveBeenCalled();
  });

  it("rejects a CONFLICTING subsequent callback (different callback_id, different fingerprint) before any mutation", async () => {
    const attempt = storedAttempt();
    const { prisma, resultCreate, attemptUpdate, intentUpdate } =
      wirePrisma(attempt);
    const controller = buildController(prisma);

    // An immutable result already exists for this attempt with a different
    // canonical fingerprint → the second signed callback must not overwrite it.
    (prisma.publishingResult!.findUnique as jest.Mock).mockResolvedValue({
      rawPayloadHash: "different-existing-fingerprint",
      outcome: "PUBLISHED",
    } as never);

    await expect(
      controller.handleCallback(ATTEMPT_ID, signEnvelope(callbackBody())),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(resultCreate).not.toHaveBeenCalled();
    expect(attemptUpdate).not.toHaveBeenCalled();
    expect(intentUpdate).not.toHaveBeenCalled();
  });

  it("rejects an envelope whose body checksum does not match body_sha256 (tampered body)", async () => {
    const attempt = storedAttempt();
    const { prisma, resultCreate } = wirePrisma(attempt);
    const controller = buildController(prisma);

    const signed = signEnvelope(callbackBody()) as unknown as {
      [k: string]: unknown;
      body: PublicationCallbackBodyV1;
    };
    // Mutate the body AFTER signing (without re-signing) — the validator must
    // catch the body_sha256 mismatch.
    const tamperedBody: PublicationCallbackBodyV1 = {
      ...signed.body,
      result: {
        ...publishedResult(),
        remote_publication_id: "tampered" as never,
      } as never,
    } as PublicationCallbackBodyV1;
    const envelope = { ...signed, body: tamperedBody } as never;

    await expect(
      controller.handleCallback(ATTEMPT_ID, envelope),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resultCreate).not.toHaveBeenCalled();
  });
});
