/**
 * Fake n8n harness — zero-credential in-process publishing workflow (P1 #123).
 *
 * Implements §3.4 of IMPLEMENTATION_PLAN_123.md. Executes the REAL node
 * JavaScript from `infra/n8n/workflows/publishing-v1.json` (Check Auth,
 * Validate Envelope Shape, Verify Signature, Real Meta Adapter (static
 * image), Manual Export Archive (manifest), Simulation Adapter
 * (zero-network), Build Callback Body, Sign Callback Envelope) over a local
 * HTTP loopback — no live n8n instance and no Meta credentials.
 *
 * Truthfulness rules (PUBLISHING_CONTRACT.md / issue #123):
 *   - This harness never resolves `graph.facebook.com`. The Real Meta
 *     Adapter's `https`/`http` transport is a loopback stub that returns the
 *     canned provider response selected via `metaProviderMode`.
 *   - Callbacks POSTed to NestJS are signed by the REAL "Sign Callback
 *     Envelope" node code with the pinned fixture secret, so the API's HMAC
 *     verification runs unchanged.
 *   - The signing secret defaults to the public fixture secret from
 *     `infra/n8n/fixtures/publishing-v1.fixture-manifest.json` so the
 *     committed frozen dispatch fixtures verify against the harness directly.
 *   - Simulation never touches a network primitive (contract guarantee);
 *     only the real-mode adapter receives the fake transport.
 *
 * Webhook response modes (`webhookMode`):
 *   - "success"       — real auth/shape/signature validation, 202 `accepted`
 *                       ack, adapter pipeline, signed callback POST.
 *   - "auth-expired"  — the REAL Check Auth node code rejects with a 401
 *                       (the workflow's stored token is simulated as stale).
 *   - "rate-limit"    — 429 before any validation (transport-level
 *                       simulation; classified deterministic by the API).
 *   - "network-error" — 500 before any validation (transport-level
 *                       simulation; classified AMBIGUOUS by the API → UNKNOWN
 *                       + STUCK_DISPATCH_TIMEOUT sentinel at NestJS).
 *   - "timeout"       — holds the request open without ever responding; the
 *                       API's safeHttp times out (ETIMEDOUT/ECONNABORTED →
 *                       AMBIGUOUS → UNKNOWN + STUCK_DISPATCH_TIMEOUT sentinel).
 *
 * Fake Meta provider modes (`metaProviderMode`, used only for mode "real"):
 *   - "success"       — 200 `{ id, post_id }` → adapter claims PUBLISHED.
 *   - "rate-limit"    — 429 `{ error: { code: 4 } }` → PUBLISHING_PROVIDER_RATE_LIMITED.
 *   - "auth-expired"  — 401 `{ error: { code: 190 } }` → PUBLISHING_TARGET_UNAUTHORIZED.
 *   - "network-error" — ECONNRESET on the POST → adapter reports UNKNOWN
 *                       (PUBLISHING_PROVIDER_OUTCOME_UNKNOWN).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ── Frozen workflow + fixtures (real sources, never duplicated) ──────────────
const REPO_ROOT = path.resolve(__dirname, "../../../../");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  "infra/n8n/workflows/publishing-v1.json",
);
const DEMO_ASSET_PATH = path.join(
  REPO_ROOT,
  "apps/api/test-assets/publishing/demo-static-image.png",
);
const DEFAULT_ASSET_BYTES = Buffer.from(
  "marketmind-fake-n8n-demo-asset-bytes-not-a-real-media-file",
  "utf8",
);

type WorkflowNode = { name: string; parameters: { jsCode?: string } };

const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8")) as {
  nodes: WorkflowNode[];
};

function workflowNode(name: string): WorkflowNode {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) {
    throw new Error(`fake-n8n-harness: workflow node "${name}" not found`);
  }
  return node;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ── Public types ─────────────────────────────────────────────────────────────
export type FakeN8nWebhookMode =
  | "success"
  | "auth-expired"
  | "rate-limit"
  | "network-error"
  | "timeout";

export type FakeMetaProviderMode =
  | "success"
  | "rate-limit"
  | "auth-expired"
  | "network-error";

export interface FakeN8nHarnessOptions {
  /** TCP port; 0 asks the OS for a free port. Default 0. */
  port?: number;
  /** Webhook-level response switching. Default "success". */
  webhookMode?: FakeN8nWebhookMode;
  /** Fake Meta transport response for the real adapter. Default "success". */
  metaProviderMode?: FakeMetaProviderMode;
  /** HMAC signing secret — defaults to the public fixture secret. */
  signingSecret?: string;
  /** Signing key id — defaults to the fixture key id. */
  signingKeyId?: string;
  /** Bearer token the API sends as `Authorization` (PUBLISHING_N8N_AUTH_TOKEN). */
  authToken?: string;
  /** Internal service token the adapter uses for asset retrieval. */
  internalToken?: string;
  /** META_TEST_PAGE_ID env for the adapter. Empty disables the page-id check. */
  metaPageId?: string;
  /** META_TEST_PAGE_ACCESS_TOKEN env for the adapter. */
  metaAccessToken?: string;
  /** Bytes served for the adapter's asset-retrieval GET. Defaults to the
   *  committed demo asset (or deterministic bytes if the file is absent). */
  assetBytes?: Buffer;
  /** Called after a signed callback is POSTed to NestJS. */
  onCallback?: (callbackUrl: string, envelope: unknown) => void;
}

export interface FakeN8nHarnessHandle {
  /** Actual bound port (useful with port 0). */
  port: number;
  /** Full webhook URL the API must POST dispatch envelopes to. */
  webhookUrl: string;
  /** Number of dispatch POSTs received. */
  dispatchCount: number;
  /** Every signed callback POSTed to NestJS, in order. */
  callbacksSent: Array<{ callbackUrl: string; envelope: unknown }>;
  /** Resolves with the first callback envelope; rejects after `timeoutMs`. */
  waitForCallback(timeoutMs?: number): Promise<unknown>;
  setWebhookMode(mode: FakeN8nWebhookMode): void;
  setMetaProviderMode(mode: FakeMetaProviderMode): void;
  /** Clears the workflow static-data nonce store (10-minute replay window). */
  resetNonceStore(): void;
  stop(): Promise<void>;
}

// ── Sandbox helpers ──────────────────────────────────────────────────────────
const cryptoOnlyRequire = (name: string): unknown => {
  if (name === "crypto") return crypto;
  throw new Error(`fake-n8n-harness: unexpected require("${name}")`);
};

/**
 * Runs a real workflow code node's jsCode inside an async sandbox with the
 * same globals the n8n runner exposes ($json, $env, $getWorkflowStaticData,
 * require). Normalizes a multi-item array return (n8n splits items) to its
 * first item so `{ json, binary }` shapes are consumed uniformly.
 */
async function runCodeNode(
  nodeName: string,
  $json: unknown,
  $env: Record<string, string>,
  localRequire: (name: string) => unknown,
  getStaticData: () => Record<string, unknown>,
): Promise<{ json: Record<string, any>; binary?: unknown }> {
  const code = workflowNode(nodeName).parameters.jsCode;
  if (!code) {
    throw new Error(
      `fake-n8n-harness: node "${nodeName}" has no executable jsCode`,
    );
  }
  const run = new AsyncFunction(
    "$json",
    "$env",
    "$getWorkflowStaticData",
    "require",
    code,
  );
  const output = await run($json, $env, getStaticData, localRequire);
  const item = Array.isArray(output) ? output[0] : output;
  if (!item || typeof item !== "object" || !("json" in item)) {
    throw new Error(
      `fake-n8n-harness: node "${nodeName}" returned an unexpected shape`,
    );
  }
  return item as { json: Record<string, any>; binary?: unknown };
}

// ── Fake https/http transport for the Real Meta Adapter ─────────────────────
interface PlannedResponse {
  status: number;
  body: Buffer;
  emitError?: boolean;
}

function createAdapterTransport(opts: {
  metaProviderMode: FakeMetaProviderMode;
  assetBytes: Buffer;
}) {
  let graphCalls = 0;

  const planMetaResponse = (): PlannedResponse => {
    switch (opts.metaProviderMode) {
      case "rate-limit":
        return {
          status: 429,
          body: Buffer.from(
            JSON.stringify({ error: { code: 4, message: "simulated rate limit" } }),
            "utf8",
          ),
        };
      case "auth-expired":
        return {
          status: 401,
          body: Buffer.from(
            JSON.stringify({ error: { code: 190, message: "simulated expired token" } }),
            "utf8",
          ),
        };
      case "network-error":
        // Connection reset on the provider POST — the adapter cannot prove
        // whether the request was accepted and must report UNKNOWN.
        return { status: 0, body: Buffer.alloc(0), emitError: true };
      case "success":
      default:
        if (graphCalls === 0) {
          return {
            status: 200,
            body: Buffer.from(
              JSON.stringify({ id: "photo-123", post_id: "post-123" }),
              "utf8",
            ),
          };
        }
        return {
          status: 200,
          body: Buffer.from(
            JSON.stringify({ link: "https://facebook.example/post-123" }),
            "utf8",
          ),
        };
    }
  };

  const request = (
    url: string,
    options: { method: string; headers: Record<string, string> },
    onResponse: (res: EventEmitter & { statusCode: number; headers: object }) => void,
  ): EventEmitter & {
    end: (payload?: Buffer) => void;
    setTimeout: (ms: number, cb: () => void) => void;
    destroy: (err: Error) => void;
  } => {
    const req = new EventEmitter() as EventEmitter & {
      end: (payload?: Buffer) => void;
      setTimeout: (ms: number, cb: () => void) => void;
      destroy: (err: Error) => void;
    };
    req.setTimeout = () => req; // adapter registers a timeout handler; no-op here
    req.destroy = (error) => req.emit("error", error);
    req.end = () => {
      queueMicrotask(() => {
        let planned: PlannedResponse;
        if (url.includes("graph.facebook.com")) {
          planned = planMetaResponse();
          graphCalls += 1;
        } else {
          // Asset retrieval (retrieval_url) — always serves the configured
          // asset bytes so the REAL adapter's sha256 checksum matches.
          planned = { status: 200, body: Buffer.from(opts.assetBytes) };
        }
        if (planned.emitError) {
          const err = new Error("simulated connection reset");
          (err as NodeJS.ErrnoException).code = "ECONNRESET";
          req.emit("error", err);
          return;
        }
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: object;
        };
        response.statusCode = planned.status;
        response.headers = {};
        onResponse(response);
        if (planned.body.length > 0) {
          response.emit("data", planned.body);
        }
        response.emit("end");
      });
    };
    return req;
  };

  return {
    request,
    graphCalls: () => graphCalls,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────
const FIXTURE_SIGNING_SECRET = "publishing-v1-fixture-secret-not-for-production";
const FIXTURE_SIGNING_KEY_ID = "fixture-key-v1";

function loadDefaultAssetBytes(): Buffer {
  try {
    if (fs.existsSync(DEMO_ASSET_PATH)) {
      return fs.readFileSync(DEMO_ASSET_PATH);
    }
  } catch {
    // fall through to deterministic bytes
  }
  return DEFAULT_ASSET_BYTES;
}

export async function startFakeN8n(
  options: FakeN8nHarnessOptions = {},
): Promise<FakeN8nHarnessHandle> {
  const signingSecret = options.signingSecret ?? FIXTURE_SIGNING_SECRET;
  const signingKeyId = options.signingKeyId ?? FIXTURE_SIGNING_KEY_ID;
  const authToken = options.authToken ?? "mm-test-n8n-bearer";
  const internalToken = options.internalToken ?? "mm-test-internal-token";
  const metaPageId = options.metaPageId ?? "";
  const metaAccessToken = options.metaAccessToken ?? "mm-test-meta-page-token";
  const assetBytes = options.assetBytes ?? loadDefaultAssetBytes();

  let webhookMode: FakeN8nWebhookMode = options.webhookMode ?? "success";
  let metaProviderMode: FakeMetaProviderMode =
    options.metaProviderMode ?? "success";

  // Shared workflow static-data store: the REAL Verify Signature node keeps
  // its 10-minute nonce replay window here, mirroring n8n's per-instance
  // staticData persistence across executions.
  let staticData: Record<string, unknown> = {};

  let dispatchCount = 0;
  const callbacksSent: Array<{ callbackUrl: string; envelope: unknown }> = [];
  let lastCallback: unknown = null;
  let callbackWaiters: Array<(v: unknown) => void> = [];

  const recordCallback = (callbackUrl: string, envelope: unknown): void => {
    callbacksSent.push({ callbackUrl, envelope });
    lastCallback = envelope;
    const waiters = callbackWaiters;
    callbackWaiters = [];
    for (const resolve of waiters) resolve(envelope);
    options.onCallback?.(callbackUrl, envelope);
  };

  const respond = (
    res: ServerResponse,
    status: number,
    body: unknown,
  ): void => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  const readJsonBody = (
    req: IncomingMessage,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          reject(new Error("dispatch payload exceeds 2MB limit"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(raw ? JSON.parse(raw) : null);
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });

  const postCallbackToNestJs = (
    callbackUrl: string,
    envelope: unknown,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const url = new URL(callbackUrl);
      const payload = JSON.stringify(envelope);
      const request = httpRequest(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
        },
      });
      request.on("response", () => resolve());
      request.on("error", reject);
      request.end(payload);
    });

  const runPipeline = async (envelope: any): Promise<void> => {
    try {
      const adapterEnv: Record<string, string> = {
        PUBLISHING_INTERNAL_SERVICE_TOKEN: internalToken,
        META_TEST_PAGE_ACCESS_TOKEN: metaAccessToken,
        META_TEST_PAGE_ID: metaPageId,
      };

      let adapterOutput: { json: Record<string, any> };
      switch (envelope.body.mode) {
        case "real": {
          const transport = createAdapterTransport({
            metaProviderMode,
            assetBytes,
          });
          const adapterRequire = (name: string): unknown => {
            if (name === "crypto") return crypto;
            if (name === "https" || name === "http") return transport;
            throw new Error(
              `fake-n8n-harness: unexpected require("${name}") in Real Meta Adapter`,
            );
          };
          adapterOutput = await runCodeNode(
            "Real Meta Adapter (static image)",
            { envelope },
            adapterEnv,
            adapterRequire,
            () => staticData,
          );
          break;
        }
        case "manual_export":
          adapterOutput = await runCodeNode(
            "Manual Export Archive (manifest)",
            { envelope },
            {},
            cryptoOnlyRequire,
            () => staticData,
          );
          break;
        case "simulation":
          adapterOutput = await runCodeNode(
            "Simulation Adapter (zero-network)",
            { envelope },
            {},
            cryptoOnlyRequire,
            () => staticData,
          );
          break;
        default:
          throw new Error(
            `fake-n8n-harness: dispatch body mode "${envelope.body.mode}" is not executable`,
          );
      }

      const built = await runCodeNode(
        "Build Callback Body",
        adapterOutput.json,
        {},
        cryptoOnlyRequire,
        () => staticData,
      );
      const { callbackBody, callback_url } = built.json as {
        callbackBody: unknown;
        callback_url: string;
      };

      const signed = await runCodeNode(
        "Sign Callback Envelope",
        { callbackBody, callback_url },
        {
          PUBLISHING_N8N_SIGNING_SECRET: signingSecret,
          PUBLISHING_N8N_SIGNING_KID: signingKeyId,
        },
        cryptoOnlyRequire,
        () => staticData,
      );
      const { callbackEnvelope } = signed.json as {
        callbackEnvelope: unknown;
      };

      await postCallbackToNestJs(callback_url, callbackEnvelope);
      recordCallback(callback_url, callbackEnvelope);
    } catch (err) {
      // The webhook already acked 202; a pipeline failure must NOT be silent
      // in tests — surface it through the waitForCallback rejection path and
      // record a marker envelope so the API-side UNKNOWN/FAILED assertions
      // stay deterministic.
      recordCallback(
        "__fake-n8n-pipeline-error__",
        { error: (err as Error).message },
      );
    }
  };

  const handleDispatch = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    dispatchCount += 1;

    // ── Transport-level response switching (before any validation) ──────
    if (webhookMode === "network-error") {
      respond(res, 500, { error: "upstream network failure (simulated)" });
      return;
    }
    if (webhookMode === "rate-limit") {
      respond(res, 429, { error: "rate limit (simulated)" });
      return;
    }
    if (webhookMode === "timeout") {
      // Hold the request open and never respond: the API's safeHttp times
      // out (ETIMEDOUT/ECONNABORTED → AMBIGUOUS → STUCK_DISPATCH_TIMEOUT).
      // Drain the body so the client can finish sending before the hold.
      try {
        await readJsonBody(req);
      } catch {
        // body parse failure — the client's request already ended; still hold.
      }
      return;
    }

    let envelope: any;
    try {
      envelope = await readJsonBody(req);
    } catch {
      respond(res, 400, { error: "invalid JSON body" });
      return;
    }
    if (!envelope || typeof envelope !== "object") {
      respond(res, 400, { error: "missing dispatch envelope" });
      return;
    }

    const headers = req.headers;

    // ── 1) REAL Check Auth node ───────────────────────────────────────────
    // "auth-expired" simulates a stale workflow credential by injecting a
    // different token into the node env — the REAL node code performs the
    // 401 rejection, exactly as it would for an expired token in production.
    const checkEnv = {
      PUBLISHING_N8N_AUTH_TOKEN:
        webhookMode === "auth-expired" ? "expired-stale-workflow-token" : authToken,
    };
    const auth = await runCodeNode(
      "Check Auth",
      { headers: { authorization: headers.authorization ?? "" } },
      checkEnv,
      cryptoOnlyRequire,
      () => staticData,
    );
    if (!auth.json.valid) {
      respond(res, auth.json.statusCode ?? 401, { error: auth.json.error });
      return;
    }

    // ── 2) REAL Validate Envelope Shape node ──────────────────────────────
    const shape = await runCodeNode(
      "Validate Envelope Shape",
      { envelope },
      {},
      cryptoOnlyRequire,
      () => staticData,
    );
    if (!shape.json.valid) {
      respond(res, shape.json.statusCode ?? 400, { error: shape.json.error });
      return;
    }

    // ── 3) REAL Verify Signature node (body_sha256 recompute, timestamp
    //       window, key id, constant-time HMAC, nonce replay store) ───────
    const signature = await runCodeNode(
      "Verify Signature",
      { envelope },
      {
        PUBLISHING_N8N_SIGNING_SECRET: signingSecret,
        PUBLISHING_N8N_SIGNING_KID: signingKeyId,
      },
      cryptoOnlyRequire,
      () => staticData,
    );
    if (!signature.json.valid) {
      respond(res, signature.json.statusCode ?? 401, {
        error: signature.json.error,
      });
      return;
    }

    // ── 4) 202 acknowledgement (the ONLY response N8nClientService accepts)
    respond(res, 202, {
      accepted: true,
      executionId: `fake-n8n-${crypto.randomUUID()}`,
    });

    // ── 5) Adapter pipeline + signed callback (async, like real n8n) ─────
    void runPipeline(envelope);
  };

  const server: Server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/webhook/publishing-dispatch") {
      handleDispatch(req, res).catch((err) => {
        respond(res, 500, { error: `harness error: ${(err as Error).message}` });
      });
      return;
    }
    respond(res, 404, { error: "not found" });
  });

  // Track live sockets so `stop()` can tear down held ("timeout" mode) and
  // idle keep-alive connections; server.close() alone would wait forever.
  const openSockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  server.removeAllListeners("error");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake-n8n-harness: failed to resolve bound port");
  }
  const port = address.port;
  const webhookUrl = `http://127.0.0.1:${port}/webhook/publishing-dispatch`;

  return {
    port,
    webhookUrl,
    get dispatchCount() {
      return dispatchCount;
    },
    callbacksSent,
    waitForCallback: (timeoutMs = 15_000) =>
      new Promise<unknown>((resolve, reject) => {
        if (lastCallback !== null) {
          resolve(lastCallback);
          return;
        }
        const timer = setTimeout(() => {
          callbackWaiters = callbackWaiters.filter((w) => w !== onCallback);
          reject(
            new Error(
              `fake-n8n-harness: timed out waiting for a callback (${timeoutMs}ms)`,
            ),
          );
        }, timeoutMs);
        const onCallback = (v: unknown): void => {
          clearTimeout(timer);
          resolve(v);
        };
        callbackWaiters.push(onCallback);
      }),
    setWebhookMode: (mode) => {
      webhookMode = mode;
    },
    setMetaProviderMode: (mode) => {
      metaProviderMode = mode;
    },
    resetNonceStore: () => {
      staticData = {};
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of openSockets) socket.destroy();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// Small local alias so the callback POST does not depend on a global fetch.
function httpRequest(
  url: URL,
  options: { method: string; headers: Record<string, string> },
): import("node:http").ClientRequest {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require("node:http") as typeof import("node:http");
  return http.request(url, options);
}
