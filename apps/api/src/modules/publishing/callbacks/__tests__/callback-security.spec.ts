/**
 * Callback security — frozen envelope validators (P1 #119).
 *
 * Replaces the previous custom HMAC/mirror unit tests. These now exercise the
 * REAL frozen contract validators the controller relies on:
 *   - `validateSignedPublicationCallbackEnvelopeV1` (signature, timestamp
 *     window, body checksum, key id, nonce length), and
 *   - `validatePublicationCallbackContext` (exact-attempt binding by
 *     attempt_id / intent_id / intent_version / request_fingerprint /
 *     workflow_version).
 *
 * The controller delegates to these same validators, so failures here would
 * fail the controller too — no mock bypass.
 */

import * as crypto from "crypto";
import {
  validateSignedPublicationCallbackEnvelopeV1,
  validatePublicationCallbackContext,
  signPublicationCallbackEnvelope,
  type PublicationCallbackBodyV1,
  type PublicationResultV1,
  type PublicationAttemptV1,
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

function body(
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

function sign(
  b: PublicationCallbackBodyV1,
  opts: {
    sentAt?: string;
    nonce?: string;
    keyId?: string;
    secret?: string;
  } = {},
) {
  return signPublicationCallbackEnvelope(
    {
      contract_version: "publishing-callback-envelope-v1",
      message_id: crypto.randomUUID(),
      sent_at: opts.sentAt ?? new Date().toISOString(),
      nonce: opts.nonce ?? crypto.randomUUID() + crypto.randomUUID(),
      key_id: opts.keyId ?? KEY_ID,
      body: b,
    },
    opts.secret ?? SECRET,
  );
}

function attemptV1(
  overrides: Partial<PublicationAttemptV1> = {},
): PublicationAttemptV1 {
  return {
    contract_version: "publication-attempt-v1",
    attempt_id: ATTEMPT_ID,
    intent_id: INTENT_ID,
    intent_version: 1,
    attempt_number: 1,
    idempotency_key: "key-1::dispatch",
    workflow_version: "v1",
    request_fingerprint: REQUEST_FINGERPRINT,
    state: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const context = () => ({
  secret: SECRET,
  expected_key_id: KEY_ID,
  now: new Date().toISOString(),
});

describe("Callback frozen-envelope security", () => {
  describe("validateSignedPublicationCallbackEnvelopeV1", () => {
    it("accepts a correctly signed envelope", () => {
      const result = validateSignedPublicationCallbackEnvelopeV1(
        sign(body()),
        context(),
      );
      expect(result.valid).toBe(true);
    });

    it("rejects a signature made with a different secret (tamper)", () => {
      const result = validateSignedPublicationCallbackEnvelopeV1(
        sign(body(), { secret: "wrong-secret" }),
        context(),
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.code).toBe("PUBLISHING_WEBHOOK_UNAUTHORIZED");
    });

    it("rejects a stale sent_at outside the 5-minute window", () => {
      const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const result = validateSignedPublicationCallbackEnvelopeV1(
        sign(body(), { sentAt: stale }),
        context(),
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.code).toBe(
        "PUBLISHING_WEBHOOK_TIMESTAMP_INVALID",
      );
    });

    it("rejects a future sent_at outside the window", () => {
      const future = new Date(Date.now() + 6 * 60 * 1000).toISOString();
      const result = validateSignedPublicationCallbackEnvelopeV1(
        sign(body(), { sentAt: future }),
        context(),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects a key id mismatch (rotation boundary)", () => {
      const result = validateSignedPublicationCallbackEnvelopeV1(
        sign(body(), { keyId: "other-kid" }),
        context(),
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.code).toBe("PUBLISHING_WEBHOOK_UNAUTHORIZED");
    });

    it("rejects a body mutated after signing (body_sha256 mismatch)", () => {
      const env = sign(body()) as unknown as {
        body: PublicationCallbackBodyV1;
      };
      const mutatedBody: PublicationCallbackBodyV1 = {
        ...env.body,
        result: {
          ...publishedResult(),
          remote_publication_id: "tampered" as never,
        } as never,
      } as PublicationCallbackBodyV1;
      const tampered = { ...env, body: mutatedBody } as never;
      const result = validateSignedPublicationCallbackEnvelopeV1(
        tampered,
        context(),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects a short nonce (< 16 chars)", () => {
      const result = validateSignedPublicationCallbackEnvelopeV1(
        sign(body(), { nonce: "short" }),
        context(),
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.code).toBe("PUBLISHING_WEBHOOK_UNAUTHORIZED");
    });
  });

  describe("validatePublicationCallbackContext — exact-attempt binding", () => {
    it("accepts a callback that binds the stored exact attempt", () => {
      const result = validatePublicationCallbackContext({
        envelope: sign(body()),
        attempt: attemptV1(),
        context: context(),
      });
      expect(result.valid).toBe(true);
    });

    it("rejects a callback whose attempt_id differs from the stored attempt", () => {
      const otherAttempt = crypto.randomUUID();
      const otherIntent = crypto.randomUUID();
      const result = validatePublicationCallbackContext({
        envelope: sign(
          body({
            attempt_id: otherAttempt as never,
            intent_id: otherIntent as never,
            result: {
              ...publishedResult(),
              attempt_id: otherAttempt as never,
              intent_id: otherIntent as never,
            } as never,
          }),
        ),
        attempt: attemptV1(),
        context: context(),
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.code).toBe("PUBLISHING_CALLBACK_CONFLICT");
    });

    it("rejects a callback whose request_fingerprint does not match the stored dispatch fingerprint (drift)", () => {
      const result = validatePublicationCallbackContext({
        envelope: sign(body()),
        attempt: attemptV1({
          request_fingerprint: crypto
            .createHash("sha256")
            .update("different")
            .digest("hex") as never,
        }),
        context: context(),
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]?.code).toBe("PUBLISHING_CALLBACK_CONFLICT");
    });

    it("rejects a callback whose workflow_version differs from the stored attempt", () => {
      const result = validatePublicationCallbackContext({
        envelope: sign(body({ workflow_version: "v9" as never })),
        attempt: attemptV1(),
        context: context(),
      });
      expect(result.valid).toBe(false);
    });
  });
});
