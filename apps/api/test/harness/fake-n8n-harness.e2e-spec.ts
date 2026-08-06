/**
 * Fake n8n harness — executable evidence (P1 #123, §3.4).
 *
 * Proves the in-process harness executes the REAL node JavaScript from
 * `infra/n8n/workflows/publishing-v1.json`: frozen fixture envelopes are
 * re-signed with the pinned fixture secret, POSTed over loopback, and the
 * harness must return the real 202 acknowledgement, run the real adapter,
 * sign the callback with the real node code, and deliver it to the local
 * callback receiver. No live n8n, no Meta credentials, no
 * `graph.facebook.com` resolution.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import {
  signPublicationDispatchEnvelope,
  validateSignedPublicationCallbackEnvelopeV1,
  type PublicationDispatchBodyV1,
  type SignedPublicationCallbackEnvelopeV1,
} from "@marketmind/contracts";
import {
  startFakeN8n,
  type FakeN8nHarnessHandle,
} from "./fake-n8n-harness";

const FIXTURE_SECRET = "publishing-v1-fixture-secret-not-for-production";
const FIXTURE_KEY_ID = "fixture-key-v1";
const AUTH_TOKEN = "mm-test-n8n-bearer";

const REPO_ROOT = path.resolve(__dirname, "../../../../");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      REPO_ROOT,
      "infra/n8n/fixtures/publishing-dispatch-real.example.json",
    ),
    "utf8",
  ),
) as { body: PublicationDispatchBodyV1 };
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, "infra/n8n/fixtures/publishing-v1.fixture-manifest.json"),
    "utf8",
  ),
) as { canonical_asset_bytes_utf8: string };
const FIXTURE_ASSET_BYTES = Buffer.from(
  manifest.canonical_asset_bytes_utf8,
  "utf8",
);

function signDispatchBody(body: PublicationDispatchBodyV1, overrides: {
  sentAt?: string;
  nonce?: string;
} = {}): SignedDispatchEnvelopeLike {
  return signPublicationDispatchEnvelope(
    {
      contract_version: "publishing-dispatch-envelope-v1",
      message_id: crypto.randomUUID(),
      sent_at: overrides.sentAt ?? new Date().toISOString(),
      nonce: overrides.nonce ?? crypto.randomUUID() + crypto.randomUUID(),
      key_id: FIXTURE_KEY_ID,
      body,
    },
    FIXTURE_SECRET,
  );
}

type SignedDispatchEnvelopeLike = ReturnType<typeof signPublicationDispatchEnvelope>;

function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data: any = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function startCallbackReceiver(): Promise<{
  port: number;
  received: Array<{ body: any }>;
  stop: () => Promise<void>;
}> {
  const received: Array<{ body: any }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        received.push({ body: JSON.parse(raw) });
      } catch {
        received.push({ body: raw });
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("receiver failed to bind"));
        return;
      }
      resolve({
        port: address.port,
        received,
        stop: () =>
          new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

function dispatchBodyWithLocalCallback(
  receiverPort: number,
  mode: "real" | "manual_export" | "simulation",
): PublicationDispatchBodyV1 {
  const body = structuredClone(fixture.body) as any;
  body.callback_url =
    `http://127.0.0.1:${receiverPort}/internal/v1/publishing/dispatch/${body.attempt_id}/callback`;
  // The frozen fixture's retrieval window (2026-08-03) has elapsed; the REAL
  // adapter rejects expired retrievals, so refresh only the time-bound field.
  body.assets[0].retrieval_expires_at = new Date(Date.now() + 3_600_000).toISOString();
  if (mode === "simulation") {
    body.mode = "simulation";
    body.operation = "simulation.run";
    body.target = null;
    body.approval = null;
    body.scheduled_utc = null;
  }
  if (mode === "manual_export") {
    body.mode = "manual_export";
    body.operation = "manual_export.build";
    body.target = null;
    body.approval = null;
    body.scheduled_utc = null;
  }
  return body as PublicationDispatchBodyV1;
}

describe("fake-n8n-harness — real workflow execution over loopback (P1 #123)", () => {
  let harness: FakeN8nHarnessHandle;
  let receiver: Awaited<ReturnType<typeof startCallbackReceiver>>;

  beforeEach(async () => {
    receiver = await startCallbackReceiver();
    harness = await startFakeN8n({
      port: 0,
      signingSecret: FIXTURE_SECRET,
      signingKeyId: FIXTURE_KEY_ID,
      authToken: AUTH_TOKEN,
      assetBytes: FIXTURE_ASSET_BYTES,
    });
  });

  afterEach(async () => {
    await harness.stop();
    await receiver.stop();
  });

  it("202-acks a valid dispatch and delivers a signed PUBLISHED callback (real adapter)", async () => {
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });

    expect(response.status).toBe(202);
    expect(response.data).toMatchObject({ accepted: true });

    const callbackEnvelope = (await harness.waitForCallback()) as SignedPublicationCallbackEnvelopeV1;
    expect(callbackEnvelope.contract_version).toBe("publishing-callback-envelope-v1");

    const validation = validateSignedPublicationCallbackEnvelopeV1(
      callbackEnvelope,
      {
        secret: FIXTURE_SECRET,
        expected_key_id: FIXTURE_KEY_ID,
        now: new Date().toISOString(),
      },
    );
    expect(validation.valid).toBe(true);

    expect(callbackEnvelope.body.result).toMatchObject({
      outcome: "published",
      provider: "meta",
      remote_publication_id: "post-123",
      remote_url: "https://facebook.example/post-123",
      reconciliation_required: false,
    });
    expect(callbackEnvelope.body.attempt_id).toBe(body.attempt_id);
    expect(callbackEnvelope.body.request_fingerprint).toBe(
      (envelope as SignedDispatchEnvelopeLike).body_sha256,
    );
    expect(receiver.received).toHaveLength(1);
  });

  it("maps a Meta 429 into a RATE_LIMITED failed callback via the real adapter", async () => {
    harness.setMetaProviderMode("rate-limit");
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });
    expect(response.status).toBe(202);

    const callbackEnvelope = (await harness.waitForCallback()) as SignedPublicationCallbackEnvelopeV1;
    expect(callbackEnvelope.body.result).toMatchObject({
      outcome: "failed",
      error_code: "PUBLISHING_PROVIDER_RATE_LIMITED",
      retryable: true,
    });
  });

  it("rejects with 401 (auth-expired) using the REAL Check Auth node code", async () => {
    harness.setWebhookMode("auth-expired");
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });

    expect(response.status).toBe(401);
    expect(response.data.error).toMatch(/PUBLISHING_WEBHOOK_UNAUTHORIZED/);
    expect(harness.callbacksSent).toHaveLength(0);
  });

  it("rejects a wrong bearer with 401 (fail closed) via the REAL Check Auth node", async () => {
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: "Bearer wrong-token",
    });

    expect(response.status).toBe(401);
    expect(harness.callbacksSent).toHaveLength(0);
  });

  it("returns 500 (network-error) with no validation and no callback", async () => {
    harness.setWebhookMode("network-error");
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });

    expect(response.status).toBe(500);
    expect(harness.callbacksSent).toHaveLength(0);
  });

  it("returns 429 (rate-limit) with no validation and no callback", async () => {
    harness.setWebhookMode("rate-limit");
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });

    expect(response.status).toBe(429);
    expect(harness.callbacksSent).toHaveLength(0);
  });

  it("holds the request open (timeout) so the API's safeHttp classifies AMBIGUOUS", async () => {
    harness.setWebhookMode("timeout");
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body);

    const start = Date.now();
    const settled = await Promise.race([
      postJson(harness.webhookUrl, envelope, {
        authorization: `Bearer ${AUTH_TOKEN}`,
      }).then((v) => ({ settled: true as const, v })),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), 1_500),
      ),
    ]);

    expect(settled.settled).toBe(false);
    expect(harness.callbacksSent).toHaveLength(0);
    expect(Date.now() - start).toBeGreaterThanOrEqual(1_400);
  });

  it("rejects a tampered signature (401) via the REAL Verify Signature node", async () => {
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body) as any;
    envelope.signature =
      (envelope.signature[0] === "a" ? "b" : "a") + envelope.signature.slice(1);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });

    expect(response.status).toBe(401);
    expect(response.data.error).toMatch(/PUBLISHING_WEBHOOK_UNAUTHORIZED/);
    expect(harness.callbacksSent).toHaveLength(0);
  });

  it("rejects a stale sent_at outside the 300s tolerance window", async () => {
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body, {
      sentAt: new Date(Date.now() - 400_000).toISOString(),
    });

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });

    expect(response.status).toBe(401);
    expect(response.data.error).toMatch(/PUBLISHING_WEBHOOK_TIMESTAMP_INVALID/);
    expect(harness.callbacksSent).toHaveLength(0);
  });

  it("rejects a replayed nonce within the 10-minute window via the REAL static-data store", async () => {
    const body = dispatchBodyWithLocalCallback(receiver.port, "real");
    const envelope = signDispatchBody(body, {
      nonce: "fixed-nonce-0000000000000000000000",
    });

    const first = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });
    expect(first.status).toBe(202);
    await harness.waitForCallback();

    const replay = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });
    expect(replay.status).toBe(401);
    expect(replay.data.error).toMatch(/PUBLISHING_WEBHOOK_NONCE_REPLAYED/);
    expect(harness.callbacksSent).toHaveLength(1);
  });

  it("runs the zero-network Simulation node and delivers a SIMULATION-labelled callback", async () => {
    const body = dispatchBodyWithLocalCallback(receiver.port, "simulation");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });
    expect(response.status).toBe(202);

    const callbackEnvelope = (await harness.waitForCallback()) as SignedPublicationCallbackEnvelopeV1;
    expect(callbackEnvelope.body.result).toMatchObject({
      outcome: "simulated",
      provider: null,
      remote_publication_id: null,
      simulation_reference_id: `sim-${body.attempt_id}`,
      simulation_label: "SIMULATION",
    });
  });

  it("runs the Manual Export node and delivers an EXPORTED callback with a manifest artifact", async () => {
    const body = dispatchBodyWithLocalCallback(receiver.port, "manual_export");
    const envelope = signDispatchBody(body);

    const response = await postJson(harness.webhookUrl, envelope, {
      authorization: `Bearer ${AUTH_TOKEN}`,
    });
    expect(response.status).toBe(202);

    const callbackEnvelope = (await harness.waitForCallback()) as SignedPublicationCallbackEnvelopeV1;
    expect(callbackEnvelope.body.result).toMatchObject({
      outcome: "exported",
      mode: "manual_export",
      provider: null,
      export_artifact_id: expect.any(String),
    });
  });
});
