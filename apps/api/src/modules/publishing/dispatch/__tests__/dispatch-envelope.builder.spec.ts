import { DispatchEnvelopeBuilder } from "../dispatch-envelope.builder";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "fs";
import { join } from "path";
import {
  validateSignedPublicationDispatchEnvelopeV1,
  computeDispatchRequestFingerprint,
  computePublicationApprovalFingerprint,
  type PublicationDispatchBodyV1,
} from "@marketmind/contracts";

/**
 * P1 (#119 review): the API must send the frozen
 * SignedPublicationDispatchEnvelopeV1. This spec exercises the ACTUAL frozen
 * contract validators (sign + validateSignedPublicationDispatchEnvelopeV1) on a
 * body assembled by DispatchEnvelopeBuilder, and asserts the attempt's
 * request_fingerprint equals the envelope body_sha256 (the callback binding).
 *
 * The candidate payload + active status are loaded from the canonical contract
 * fixtures so the candidate checksum matches its immutable payload (a frozen
 * invariant the validator checks).
 */

const SECRET = "test-signing-secret-32-chars-long-xx";
const KEY_ID = "kid-1";

const examplesDir = join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "contracts",
  "examples",
);
const createdEvent = JSON.parse(
  readFileSync(
    join(examplesDir, "publication-candidate-created-event.example.json"),
    "utf8",
  ) as never,
) as { payload: never };
const CANDIDATE_PAYLOAD = createdEvent.payload;
const ACTIVE_STATUS = JSON.parse(
  readFileSync(
    join(examplesDir, "publication-candidate-status-active.example.json"),
    "utf8",
  ) as never,
) as never;

function makeConfig(): ConfigService {
  return {
    get: (k: string) =>
      k === "publishing.callbackBaseUrl"
        ? "http://localhost:3001"
        : k === "publishing.n8nSigningKeyId"
          ? KEY_ID
          : k === "publishing.workflowVersion"
            ? "v1"
            : "",
  } as unknown as ConfigService;
}

function buildBody(): { body: PublicationDispatchBodyV1; fp: string } {
  const builder = new DispatchEnvelopeBuilder(makeConfig());
  const scheduledUtcAt = new Date("2026-08-03T18:00:00.000Z");
  const BUSINESS_ID = "11111111-1111-4111-8111-111111111111"; // candidate.business_id
  const { body, requestFingerprint } = builder.buildDispatchBody({
    attemptId: "11111100-0000-4000-8000-000000000010",
    intentId: "11111100-0000-4000-8000-000000000002",
    intentVersion: 1,
    businessId: BUSINESS_ID,
    idempotencyKey: "key-1::dispatch",
    candidate: CANDIDATE_PAYLOAD,
    candidateStatus: ACTIVE_STATUS,
    target: {
      id: "77777700-0000-4000-8000-000000000001",
      businessId: BUSINESS_ID,
      provider: "META",
      channel: "facebook",
      externalAccountId: "fb-acct",
      displayName: "Acme Page",
      connectionState: "CONNECTED",
      credentialRef: "cred-ref",
      capabilities: ["static_image"],
      lastVerifiedAt: null,
      version: 1,
    },
    approval: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      candidateChecksum:
        "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
      decidedByUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      decidedAt: new Date("2026-08-01T11:00:00+03:00"),
    },
    scheduledUtcAt,
    scheduledLocalAt: new Date("2026-08-03T18:00:00.000Z"),
    timezone: "Africa/Cairo",
  });
  return { body, fp: requestFingerprint };
}

describe("DispatchEnvelopeBuilder (frozen contract validators — P1 #119)", () => {
  it("assembles a real-mode PublicationDispatchBodyV1 with the frozen contract shape", () => {
    const { body } = buildBody();
    expect(body.contract_version).toBe("publication-dispatch-v1");
    expect(body.mode).toBe("real");
    expect(body.operation).toBe("meta.publish_static_image");
    expect(body.workflow_version).toBe("v1");
    expect(body.idempotency_key).toBe("key-1::dispatch");
    expect(body.callback_url).toBe(
      "http://localhost:3001/internal/v1/publishing/dispatch/11111100-0000-4000-8000-000000000010/callback",
    );
    // Candidate bytes + active status + immutable target snapshot travel inline.
    expect(body.candidate).toBe(CANDIDATE_PAYLOAD);
    expect(
      (body.candidate_status as { candidate_state: string }).candidate_state,
    ).toBe("active");
    expect(body.target.connection_state).toBe("connected");
    expect(body.target.credential_ref).toBe("cred-ref");
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0].retrieval_url).toBe(
      "http://localhost:3001/internal/v1/publishing/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("computes the attempt request_fingerprint as the canonical dispatch body hash", () => {
    const { body, fp } = buildBody();
    // The callback binds request_fingerprint === envelope.body_sha256.
    expect(fp).toBe(computeDispatchRequestFingerprint(body));
  });

  it("computes the approval fingerprint via the frozen publication-approval-v1 helper", () => {
    const { body } = buildBody();
    if (body.mode !== "real") throw new Error("expected real mode");
    const { approval_fingerprint, ...snapshot } = body.approval;
    expect(approval_fingerprint).toBe(
      computePublicationApprovalFingerprint(snapshot as never),
    );
  });

  it("signs an envelope the frozen validateSignedPublicationDispatchEnvelopeV1 accepts", () => {
    const builder = new DispatchEnvelopeBuilder(makeConfig());
    const { body } = buildBody();
    const envelope = builder.signEnvelope(body, SECRET);

    expect(envelope.signature_algorithm).toBe("hmac-sha256");
    expect(envelope.key_id).toBe(KEY_ID);
    expect(envelope.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.body_sha256).toBe(computeDispatchRequestFingerprint(body));

    // The FROZEN contract validator accepts the signed envelope.
    const result = validateSignedPublicationDispatchEnvelopeV1(envelope, {
      secret: SECRET,
      expected_key_id: KEY_ID,
      now: envelope.sent_at,
    });
    if (!result.valid) {
      // eslint-disable-next-line no-console
      console.error(
        "ENVELOPE_VALIDATION_ISSUES",
        JSON.stringify(result.issues),
      );
    }
    expect(result.valid).toBe(true);
  });
});
