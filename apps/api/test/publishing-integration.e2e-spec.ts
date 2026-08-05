/**
 * Publishing Integration E2E (issue #123) — real app + REAL workflow JS.
 *
 * Boots the full NestJS app (Prisma, BullMQ, throttler, guards) against the
 * test DB (`apps/api/.env.test`), points `PUBLISHING_N8N_WEBHOOK_URL` at the
 * in-process fake-n8n harness (which executes the REAL `publishing-v1.json`
 * node JavaScript over loopback), and drives the complete
 * candidate → intent → schedule → approve → dispatch → callback chain over
 * real HTTP. No live n8n, no Meta credentials, `graph.facebook.com` never
 * resolves (harness transport is a loopback stub).
 *
 * Suites (IMPLEMENTATION_PLAN_123.md §4):
 *   A — valid real-mode dispatch → SUCCEEDED + PUBLISHED + verified callback
 *   B — provider legs (rate-limit / auth-expired / network-error / timeout)
 *   C — manual export → SUCCEEDED + EXPORTED + manifest artifact + verifier
 *   D — simulation → SUCCEEDED + SIMULATED + SIMULATION label preserved
 *   E — unapproved / tampered / revoked / expired-target
 *   F — ambiguous dispatch → UNKNOWN + STUCK_DISPATCH_TIMEOUT sentinel
 *   G — replay/idempotency matrix (duplicate job, conflicting callback,
 *       route binding, timestamp, signature, single-PUBLISHED partial index)
 *   H — reschedule invalidation / expired target at dispatch / asset mismatch
 *       (stale-job + pre-call integrity guards)
 *   I — negative guarantees (unlabelled simulation rejected, cross-tenant
 *       export access denied, simulation no-provider-call spy)
 */

import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type {
  PublishingAttempt,
  PublishingCallbackIdentity,
  PublishingResult,
} from "@prisma/client";
import { Redis } from "ioredis";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "../src/common/persistence/prisma.service";
import {
  computePublicationCandidateChecksum,
  signPublicationCallbackEnvelope,
  validatePublicationCandidateV1,
  validateSignedPublicationCallbackEnvelopeV1,
  type PublicationCandidateV1,
  type PublicationResultV1,
  type SignedPublicationCallbackEnvelopeV1,
} from "@marketmind/contracts";
import { AppModule } from "../src/app.module";
import {
  startFakeN8n,
  type FakeN8nHarnessHandle,
} from "./harness/fake-n8n-harness";

jest.setTimeout(240_000);

// CI has no `apps/api/.env.test` (gitignored), so the app's env schema
// (env.schema.ts) and the harness would see empty required vars at boot.
// Pin deterministic test values at module scope — the same pattern every
// other e2e spec uses — so the suite is self-sufficient on any runner.
// Locally, the `dotenv` load in beforeAll overrides these from `.env.test`.
process.env.JWT_ACCESS_SECRET ??= "publishing-e2e-access-secret";
process.env.JWT_REFRESH_SECRET ??= "publishing-e2e-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
process.env.WEB_ORIGIN ??= "http://localhost:3000";
process.env.COOKIE_SECURE ??= "false";
process.env.COOKIE_SAME_SITE ??= "lax";
process.env.GOOGLE_CLIENT_ID ??= "publishing-e2e-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "publishing-e2e-google-client-secret";
process.env.GOOGLE_CALLBACK_URL ??=
  "http://localhost:3001/api/v1/auth/google/callback";
// Shared signing material: the API and the fake-n8n harness must agree on
// these exactly, or every signed dispatch/callback would be rejected.
process.env.PUBLISHING_INTERNAL_SERVICE_TOKEN ??= "publishing-e2e-internal-token";
process.env.PUBLISHING_N8N_SIGNING_SECRET ??= "publishing-e2e-signing-secret";
process.env.PUBLISHING_N8N_SIGNING_KID ??= "publishing-e2e-signing-kid";
process.env.PUBLISHING_N8N_AUTH_TOKEN ??= "publishing-e2e-n8n-auth-token";
process.env.META_TEST_PAGE_ID ??= "page_ci_test_123";
process.env.META_TEST_PAGE_ACCESS_TOKEN ??= "EAA-test-token-publishing-e2e";

const API_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");
const ENV_TEST_PATH = path.join(API_DIR, ".env.test");
const APP_PORT = 3101;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const OWNER_EMAIL = "owner-e2e-123@marketmind.test";
const TARGET_ID = "11111111-2222-4111-8111-111111111111";
const CANDIDATE_EVENT_PATH = path.join(
  REPO_ROOT,
  "packages/contracts/examples/publication-candidate-created-event.example.json",
);

// Committed demo asset (single source of truth: apps/api/test-assets/publishing/manifest.json).
const DEMO_ASSET_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_ASSET_CHECKSUM =
  "2420878df7d5b8397e29c46a9ae69067b7dc45c358c23ecc55fb676d6ce3fd0a";

const uuid = () => crypto.randomUUID();

function cairoLocalIn(secondsAhead: number): string {
  const target = new Date(Date.now() + secondsAhead * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(target);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}:${get("second")}`;
}

interface ApiResponse {
  status: number;
  body: any;
}

async function api(
  pathname: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    internalToken?: string;
  } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.internalToken) {
    headers["x-publishing-internal-token"] = opts.internalToken;
  }
  const response = await fetch(`${APP_ORIGIN}${pathname}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
  label = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

function buildCandidatePayload(
  businessId: string,
  overrides: Partial<PublicationCandidateV1> = {},
): PublicationCandidateV1 {
  const createdEvent = JSON.parse(
    fs.readFileSync(CANDIDATE_EVENT_PATH, "utf8"),
  ) as { payload: PublicationCandidateV1 };
  const payload = structuredClone(createdEvent.payload) as any;
  payload.candidate_id = uuid();
  payload.business_id = businessId;
  payload.strategy_id = uuid();
  payload.content_cycle_id = uuid();
  payload.content_pack_id = uuid();
  payload.content_item_id = uuid();
  payload.content_item_version_id = uuid();
  payload.content_item_version_checksum = `item-checksum-${uuid()}`;
  // The dispatch-time integrity validator resolves asset bytes from the
  // committed demo manifest (test-assets/publishing/manifest.json), so the
  // candidate must reference the manifest's asset id + checksum.
  payload.assets = [
    {
      asset_id: DEMO_ASSET_ID,
      kind: "generated_static",
      mime_type: "image/png",
      storage_key: "content/demo/demo-static-image.png",
      checksum: DEMO_ASSET_CHECKSUM,
    },
  ];
  payload.approval = {
    ...payload.approval,
    decision_id: uuid(),
    content_item_version_id: payload.content_item_version_id,
    content_item_version_checksum: payload.content_item_version_checksum,
  };
  payload.created_at = new Date().toISOString();
  payload.candidate_checksum = "";
  const checksum = computePublicationCandidateChecksum(
    payload as PublicationCandidateV1,
  );
  const candidate = { ...payload, candidate_checksum: checksum };
  const validation = validatePublicationCandidateV1(candidate);
  if (!validation.valid) {
    throw new Error(
      `Suite helper built an invalid candidate: ${validation.issues
        .map((i) => `${i.code}@${i.field}`)
        .join("; ")}`,
    );
  }
  return { ...candidate, ...overrides };
}

function ingestEvent(
  payload: PublicationCandidateV1,
  overrides: { eventType?: string; occurredAt?: string } = {},
) {
  return {
    event_id: uuid(),
    event_type: overrides.eventType ?? "content.publication_candidate.created.v1",
    occurred_at: overrides.occurredAt ?? new Date().toISOString(),
    correlation_id: uuid(),
    payload,
  };
}

/**
 * Builds a VALID candidate whose asset checksum does NOT match the committed
 * demo asset bytes (F4): the payload is internally consistent (candidate
 * checksum is recomputed AFTER the override) so ingest accepts it, but the
 * dispatch-time asset integrity validator must reject it with
 * PUBLISHING_ASSET_TAMPERED BEFORE any n8n call.
 */
function buildCandidateWithAssetMismatch(businessId: string): PublicationCandidateV1 {
  const candidate = buildCandidatePayload(businessId) as any;
  candidate.assets[0].checksum =
    "0000000000000000000000000000000000000000000000000000000000000000";
  candidate.candidate_checksum = "";
  const checksum = computePublicationCandidateChecksum(
    candidate as PublicationCandidateV1,
  );
  const result = { ...candidate, candidate_checksum: checksum };
  const validation = validatePublicationCandidateV1(result);
  if (!validation.valid) {
    throw new Error(
      `asset-mismatch helper built an invalid candidate: ${validation.issues
        .map((i) => `${i.code}@${i.field}`)
        .join("; ")}`,
    );
  }
  return result;
}

/**
 * Re-signs a previously captured callback envelope with a MUTATED body (new
 * callback_id + optional result/fields), keeping the exact attempt binding
 * (attempt_id, intent_id, intent_version, request_fingerprint, workflow_version)
 * so it still passes `validatePublicationCallbackContext` when we want it to.
 * The signature is computed by the REAL frozen contract helper with the test
 * signing secret — no manual HMAC in the test.
 */
function resignCallback(
  captured: SignedPublicationCallbackEnvelopeV1,
  mutate: (body: any) => void,
  opts: { sentAt?: string } = {},
): SignedPublicationCallbackEnvelopeV1 {
  const body = structuredClone(captured.body);
  mutate(body);
  return signPublicationCallbackEnvelope(
    {
      contract_version: "publishing-callback-envelope-v1",
      message_id: uuid(),
      sent_at: opts.sentAt ?? new Date().toISOString(),
      nonce: uuid(),
      key_id: signingKeyIdFor(),
      body,
    },
    signingSecretFor(),
  );
}

// Deferred binding so helpers stay usable before `beforeAll` sets them.
let testSigningSecret = "";
let testSigningKeyId = "";
function signingSecretFor(): string {
  return testSigningSecret;
}
function signingKeyIdFor(): string {
  return testSigningKeyId;
}

describe("Publishing integration (issue #123, real workflow JS)", () => {
  let app: INestApplication;
  let harness: FakeN8nHarnessHandle;
  let prisma: PrismaService;
  let redis: Redis;
  let ownerToken: string;
  let businessId: string;
  let internalToken: string;
  let signingSecret: string;
  let signingKeyId: string;

  beforeAll(async () => {
    dotenv.config({ path: ENV_TEST_PATH, override: true });
    internalToken = process.env.PUBLISHING_INTERNAL_SERVICE_TOKEN!;
    signingSecret = process.env.PUBLISHING_N8N_SIGNING_SECRET!;
    signingKeyId = process.env.PUBLISHING_N8N_SIGNING_KID!;
    testSigningSecret = signingSecret;
    testSigningKeyId = signingKeyId;

    // 1) Reset the test DB to a known schema.
    execSync("npx prisma migrate reset --force --skip-seed", {
      cwd: API_DIR,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL!,
        DIRECT_URL: process.env.DIRECT_URL!,
      },
      stdio: "pipe",
    });

    // 2) Flush Redis (BullMQ queues + outboxes).
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    await redis.flushall();

    // 3) Start the fake-n8n harness with the SAME signing secret the API uses.
    harness = await startFakeN8n({
      port: 0,
      signingSecret,
      signingKeyId,
      authToken: process.env.PUBLISHING_N8N_AUTH_TOKEN!,
      internalToken,
      metaPageId: process.env.META_TEST_PAGE_ID!,
      metaAccessToken: process.env.META_TEST_PAGE_ACCESS_TOKEN!,
    });

    // 4) Point the app at the harness + advertise loopback callback URL.
    process.env.PUBLISHING_N8N_WEBHOOK_URL = harness.webhookUrl;
    process.env.PUBLISHING_CALLBACK_BASE_URL = APP_ORIGIN;
    process.env.PORT = String(APP_PORT);

    // 5) Boot the real app module (worker included).
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Mirror main.ts exactly: global prefix + validation pipe.
    app.setGlobalPrefix("api/v1", { exclude: ["internal/*splat"] });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    await app.listen(APP_PORT, "127.0.0.1");

    // 6) Seed owner + business + connected Meta target via Prisma.
    prisma = app.get(PrismaService);
    const owner = await prisma.user.create({
      data: {
        email: OWNER_EMAIL,
        password: "not-a-real-password-hash",
        roles: ["OWNER"],
        fullName: "E2E Owner",
      },
    });
    const business = await prisma.business.create({
      data: {
        ownerUserId: owner.id,
        displayName: "E2E Business",
        businessType: "retail",
        city: "Cairo",
        status: "active",
      },
    });
    businessId = business.id;
    await prisma.publishingTarget.upsert({
      where: { id: TARGET_ID },
      update: {
        businessId,
        provider: "META",
        channel: "facebook",
        externalAccountId: process.env.META_TEST_PAGE_ID!,
        displayName: "E2E Meta Page",
        credentialRef: "env:META_TEST_PAGE_ACCESS_TOKEN",
        connectionState: "CONNECTED",
        capabilities: ["static_image"],
        lastVerifiedAt: new Date(),
      },
      create: {
        id: TARGET_ID,
        businessId,
        provider: "META",
        channel: "facebook",
        externalAccountId: process.env.META_TEST_PAGE_ID!,
        displayName: "E2E Meta Page",
        credentialRef: "env:META_TEST_PAGE_ACCESS_TOKEN",
        connectionState: "CONNECTED",
        capabilities: ["static_image"],
        lastVerifiedAt: new Date(),
      },
    });

    // 7) Mint an owner JWT the same way AuthService does.
    ownerToken = jwt.sign(
      { sub: owner.id, email: owner.email, roles: ["OWNER"] },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "15m" },
    );
  }, 240_000);

  afterAll(async () => {
    await harness?.stop();
    await app?.close();
    await redis?.quit();
  });

  /**
   * Full real journey: ingest candidate → create intent → schedule →
   * approve (enqueues the BullMQ dispatch job) → poll until the intent
   * leaves DISPATCHING. Returns the intent id + its first attempt (with
   * result + callback identity) for outcome assertions.
   */
  async function publishJourney(
    candidate: PublicationCandidateV1,
    opts: { mode: "REAL" | "MANUAL_EXPORT" | "SIMULATION"; scheduleAheadSeconds: number },
  ): Promise<{
    intentId: string;
    attempt: PublishingAttempt & {
      result: PublishingResult | null;
      callbacks: PublishingCallbackIdentity[];
    };
  }> {
    const ingest = await api(
      "/internal/v1/publishing/candidates/ingest",
      { method: "POST", body: ingestEvent(candidate), internalToken },
    );
    expect(ingest.status).toBe(200);
    expect(ingest.body).toMatchObject({ disposition: "applied" });

    const create = await api("/api/v1/publication-intents", {
      method: "POST",
      token: ownerToken,
      body: {
        candidateId: candidate.candidate_id,
        mode: opts.mode,
        idempotencyKey: `create-${uuid()}`,
      },
    });
    if (create.status !== 201) {
      console.log("create response:", JSON.stringify(create, null, 2));
    }
    expect(create.status).toBe(201);
    const intentId = create.body.id;
    const createVersion = create.body.version as number;

    const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
      method: "PUT",
      token: ownerToken,
      body: {
        scheduledLocalAt: cairoLocalIn(opts.scheduleAheadSeconds),
        timezone: "Africa/Cairo",
        targetId: TARGET_ID,
        currentVersion: createVersion,
        idempotencyKey: `schedule-${uuid()}`,
      },
    });
    if (schedule.status !== 200) {
      console.log("schedule response:", JSON.stringify(schedule, null, 2));
    }
    expect(schedule.status).toBe(200);
    const scheduledVersion = schedule.body.version as number;

    const approve = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
      method: "POST",
      token: ownerToken,
      body: {
        decision: "APPROVED",
        currentVersion: scheduledVersion,
        candidateChecksum: candidate.candidate_checksum,
        idempotencyKey: `approve-${uuid()}`,
      },
    });
    expect(approve.status).toBe(201);

    // The real BullMQ worker dispatches to the harness, the REAL adapter runs,
    // the REAL Sign Callback node signs, and the callback route applies the
    // outcome. Terminal states: SUCCEEDED / FAILED / ACTION_REQUIRED.
    await waitFor(
      async () => {
        const intent = await prisma.publishingIntent.findUnique({
          where: { id: intentId },
        });
        return (
          intent?.status === "SUCCEEDED" ||
          intent?.status === "FAILED" ||
          intent?.status === "ACTION_REQUIRED"
        );
      },
      60_000,
      750,
      `intent ${intentId} → terminal`,
    ).catch(async (err) => {
      const state = await prisma.publishingIntent.findUnique({
        where: { id: intentId },
        include: { attempts: { include: { result: true } } },
      });
      console.log(
        "intent state at timeout:",
        JSON.stringify(
          {
            status: state?.status,
            attempts: state?.attempts.map((a) => ({
              status: a.status,
              error: a.sanitizedError,
              result: a.result?.outcome,
              resultError: a.result?.errorCode,
            })),
            harnessCallbacks: harness.callbacksSent.length,
            harnessDispatchCount: harness.dispatchCount,
          },
          null,
          2,
        ),
      );
      throw err;
    });

    const intent = await prisma.publishingIntent.findUniqueOrThrow({
      where: { id: intentId },
      include: {
        attempts: {
          orderBy: { attemptSequence: "asc" },
          include: { result: true, callbacks: true },
        },
      },
    });
    return { intentId, attempt: intent.attempts[0] };
  }

  // ── Suite A — valid real-mode dispatch → SUCCEEDED ────────────────────────
  describe("Suite A: valid real-mode dispatch reaches SUCCEEDED", () => {
    it("ingests a frozen-valid candidate and drives it to PUBLISHED via the harness", async () => {
      const candidate = buildCandidatePayload(businessId);
      const { intentId, attempt } = await publishJourney(candidate, {
        mode: "REAL",
        scheduleAheadSeconds: 10,
      });

      expect(intentId).toBeTruthy();
      expect(attempt.status).toBe("SUCCEEDED");
      expect(attempt.workflowVersion).toBe("v1");
      expect(attempt.providerRequestFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(attempt.n8nExecutionRef).toMatch(/^fake-n8n-/);

      expect(attempt.result).toMatchObject({
        outcome: "PUBLISHED",
        provider: "meta",
        remotePublicationId: "post-123",
        remoteUrl: "https://facebook.example/post-123",
        retryable: false,
        simulationLabel: null,
      });
      expect(attempt.result.rawPayloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(attempt.callbacks[0].signatureValid).toBe(true);

      // The callback envelope itself must pass the frozen contract validator
      // with the SAME secret the harness signed with.
      expect(harness.callbacksSent).toHaveLength(1);
      const callbackEnvelope = harness.callbacksSent[0]
        .envelope as SignedPublicationCallbackEnvelopeV1;
      const validation = validateSignedPublicationCallbackEnvelopeV1(
        callbackEnvelope,
        { secret: signingSecret, expected_key_id: signingKeyId, now: new Date().toISOString() },
      );
      expect(validation.valid).toBe(true);
      expect(callbackEnvelope.body.attempt_id).toBe(attempt.id);
      expect(callbackEnvelope.body.request_fingerprint).toBe(
        attempt.providerRequestFingerprint,
      );
    }, 120_000);
  });

  // ── Suite B — provider legs (real adapter against the fake transport) ─────
  describe("Suite B: provider outcome legs", () => {
    it("maps a Meta 429 to FAILED + PUBLISHING_PROVIDER_RATE_LIMITED (retryable)", async () => {
      harness.setMetaProviderMode("rate-limit");
      const { intentId, attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );

      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
      });
      expect(intent.status).toBe("FAILED");
      expect(attempt.status).toBe("FAILED");
      expect(attempt.result).toMatchObject({
        outcome: "FAILED",
        errorCode: "PUBLISHING_PROVIDER_RATE_LIMITED",
        retryable: true,
      });
    }, 120_000);

    it("maps a Meta 401 to FAILED + PUBLISHING_TARGET_UNAUTHORIZED (deterministic)", async () => {
      harness.setMetaProviderMode("auth-expired");
      const { attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );

      expect(attempt.status).toBe("FAILED");
      expect(attempt.result).toMatchObject({
        outcome: "FAILED",
        errorCode: "PUBLISHING_TARGET_UNAUTHORIZED",
        retryable: false,
      });
    }, 120_000);

    it("maps a Meta connection reset to UNKNOWN + ACTION_REQUIRED (never blind retry)", async () => {
      harness.setMetaProviderMode("network-error");
      const { intentId, attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );

      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
      });
      expect(intent.status).toBe("ACTION_REQUIRED");
      expect(attempt.status).toBe("UNKNOWN");
      expect(attempt.result).toMatchObject({
        outcome: "UNKNOWN",
        errorCode: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
        retryable: false,
      });
    }, 120_000);

    it("accepts an identical replay fired concurrently with no double-write (§3.1 acceptance)", async () => {
      harness.setMetaProviderMode("success");
      const { attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );

      const envelope = harness.callbacksSent.find(
        (c) => (c.envelope as { body?: { attempt_id?: string } }).body?.attempt_id === attempt.id,
      )!.envelope;
      const callbackPath = `/internal/v1/publishing/dispatch/${attempt.id}/callback`;
      const [first, second] = await Promise.all([
        api(callbackPath, { method: "POST", body: envelope }),
        api(callbackPath, { method: "POST", body: envelope }),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);

      const identities = await prisma.publishingCallbackIdentity.count({
        where: { attemptId: attempt.id },
      });
      const results = await prisma.publishingResult.count({
        where: { attemptId: attempt.id },
      });
      expect(identities).toBe(1);
      expect(results).toBe(1);
    }, 120_000);
  });

  // ── Suite C — manual export (deterministic local action, no network) ──────
  describe("Suite C: manual export archive", () => {
    it("builds the checksum-addressed archive, records EXPORTED, and serves the download", async () => {
      const candidate = buildCandidatePayload(businessId);
      const ingest = await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      expect(ingest.status).toBe(200);

      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "MANUAL_EXPORT",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;

      const exported = await api(`/api/v1/publication-intents/${intentId}/dispatch-export`, {
        method: "POST",
        token: ownerToken,
        body: { idempotencyKey: `export-${uuid()}` },
      });
      expect(exported.status).toBe(201);

      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { attempts: { include: { result: true } }, exportMeta: true },
      });
      expect(intent.status).toBe("SUCCEEDED");
      const attempt = intent.attempts[0];
      expect(attempt.status).toBe("SUCCEEDED");
      expect(attempt.result).toMatchObject({
        outcome: "EXPORTED",
        provider: null,
        exportArtifactId: expect.any(String),
        simulationLabel: null,
      });

      const meta = await api(`/api/v1/publication-intents/${intentId}/export`, {
        token: ownerToken,
      });
      expect(meta.status).toBe(200);
      expect(meta.body).toBeInstanceOf(Array);
      expect(meta.body[0]).toMatchObject({
        id: expect.any(String),
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
        exportType: "manual_archive_targz",
        status: "ready",
        downloadUrl: expect.stringMatching(
          new RegExp(`/publication-intents/${intentId}/export/download$`),
        ),
      });
      // The frozen manifest is surfaced by GET /export, not fabricated by the
      // client: identity, label, and checksums come from the stored archive.
      expect(meta.body[0].manifest).toMatchObject({
        contract_version: "publishing-export-manifest-v1",
        artifact_id: meta.body[0].artifactId,
        candidate_id: candidate.candidate_id,
        candidate_checksum: candidate.candidate_checksum,
        label: "EXPORTED_NOT_PUBLISHED",
        target_channel: candidate.target_channel,
        content_format: candidate.content_format,
        selected_locale: candidate.selected_locale,
      });
      expect(meta.body[0].manifest.assets[0].checksum).toBe(
        DEMO_ASSET_CHECKSUM,
      );

      // Raw fetch: the archive is binary, and we need the checksum header.
      const downloadResponse = await fetch(
        `${APP_ORIGIN}/api/v1/publication-intents/${intentId}/export/download`,
        { headers: { authorization: `Bearer ${ownerToken}` } },
      );
      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.headers.get("x-publishing-export-checksum")).toBe(
        meta.body[0].checksum,
      );
      const archiveBytes = Buffer.from(await downloadResponse.arrayBuffer());

      // Evidence (plan §4.4 D1 + §6.1 #3): run the COMMITTED
      // verify-export-archive script against the produced manifest and assert
      // exit 0 + OK — not just the in-memory API shape.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-export-verify-"));
      const archivePath = path.join(tmpDir, `${meta.body[0].id}.tar.gz`);
      fs.writeFileSync(archivePath, archiveBytes);
      execSync(`tar -xzf ${archivePath} -C ${tmpDir} manifest.json`, {
        cwd: API_DIR,
        stdio: "pipe",
      });
      const manifestPath = path.join(tmpDir, "manifest.json");
      expect(fs.existsSync(manifestPath)).toBe(true);
      const verify = execSync(
        `npx ts-node scripts/verify-export-archive.ts ${manifestPath}`,
        { cwd: API_DIR, stdio: "pipe", encoding: "utf8" },
      );
      expect(verify).toMatch(/verify-export-archive: OK/);
      const rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(rawManifest.contract_version).toBe("publishing-export-manifest-v1");
      expect(rawManifest.assets[0].checksum).toBe(DEMO_ASSET_CHECKSUM);
    }, 60_000);
  });

  // ── Suite D — simulation (zero network, permanent SIMULATION label) ───────
  describe("Suite D: simulation keeps the SIMULATION label", () => {
    it("dispatches a simulation with no external request and stores the label", async () => {
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );

      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "SIMULATION",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;

      // No-provider spy: the simulation path must never reach the webhook.
      const dispatchBefore = harness.dispatchCount;
      const simulated = await api(`/api/v1/publication-intents/${intentId}/dispatch-simulation`, {
        method: "POST",
        token: ownerToken,
        body: { idempotencyKey: `sim-${uuid()}` },
      });
      expect(simulated.status).toBe(201);
      expect(harness.dispatchCount).toBe(dispatchBefore);

      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { attempts: { include: { result: true } } },
      });
      expect(intent.status).toBe("SUCCEEDED");
      const attempt = intent.attempts[0];
      expect(attempt.status).toBe("SUCCEEDED");
      expect(attempt.result).toMatchObject({
        outcome: "SIMULATED",
        provider: null,
        remotePublicationId: null,
        simulationLabel: "SIMULATION",
      });
    }, 60_000);
  });

  // ── Suite E — unapproved / tampered / revoked / expired-target ────────────
  describe("Suite E: rejected and blocked journeys", () => {
    it("never dispatches an intent that is scheduled but not approved", async () => {
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      const intentId = create.body.id;
      const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
        method: "PUT",
        token: ownerToken,
        body: {
          scheduledLocalAt: cairoLocalIn(10),
          timezone: "Africa/Cairo",
          targetId: TARGET_ID,
          currentVersion: create.body.version,
          idempotencyKey: `schedule-${uuid()}`,
        },
      });
      expect(schedule.status).toBe(200);

      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { attempts: true },
      });
      expect(intent.status).toBe("AWAITING_APPROVAL");
      expect(intent.attempts).toHaveLength(0);
    }, 60_000);

    it("rejects a tampered candidate at ingest with no row written", async () => {
      const candidate = buildCandidatePayload(businessId) as any;
      // Tamper the caption but keep the original checksum: the signature no
      // longer covers the payload → PUBLISHING_CANDIDATE_TAMPERED.
      candidate.caption = `${candidate.caption} — tampered after signing`;

      const ingest = await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      expect(ingest.status).toBe(422);
      expect(ingest.body.message).toContain("TAMPERED");
      const row = await prisma.publishingCandidate.findUnique({
        where: { id: candidate.candidate_id },
      });
      expect(row).toBeNull();
    }, 60_000);

    it("blocks publication of a revoked candidate (CANDIDATE_REVOKED)", async () => {
      harness.setMetaProviderMode("success");
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      // Revoke it BEFORE the intent journey.
      const revoked = await api(
        "/internal/v1/publishing/candidates/ingest",
        {
          method: "POST",
          internalToken,
          body: ingestEvent(
            {
              contract_version: "publication-candidate-status-v1",
              candidate_id: candidate.candidate_id,
              business_id: businessId,
              candidate_checksum: candidate.candidate_checksum,
              state_version: 2,
              candidate_state: "revoked",
              replacement_candidate_id: null,
              changed_by_user_id: uuid(),
              changed_at: new Date().toISOString(),
            } as any,
            { eventType: "content.publication_candidate.state_changed.v1" },
          ),
        },
      );
      expect(revoked.status).toBe(200);
      expect(revoked.body.disposition).toBe("applied");

      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(422);
      expect(create.body.message).toContain("PUBLISHING_CANDIDATE_REVOKED");
      const attempts = await prisma.publishingAttempt.count({
        where: { intent: { candidateId: candidate.candidate_id } },
      });
      expect(attempts).toBe(0);
    }, 60_000);

    it("rejects scheduling against an expired target", async () => {
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      const intentId = create.body.id;

      await prisma.publishingTarget.update({
        where: { id: TARGET_ID },
        data: { connectionState: "EXPIRED" },
      });
      try {
        const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
          method: "PUT",
          token: ownerToken,
          body: {
            scheduledLocalAt: cairoLocalIn(10),
            timezone: "Africa/Cairo",
            targetId: TARGET_ID,
            currentVersion: create.body.version,
            idempotencyKey: `schedule-${uuid()}`,
          },
        });
        expect(schedule.status).toBe(400);
        expect(schedule.body.message).toContain("PUBLISHING_TARGET_NOT_CONNECTED");
      } finally {
        await prisma.publishingTarget.update({
          where: { id: TARGET_ID },
          data: { connectionState: "CONNECTED" },
        });
      }
    }, 60_000);
  });

  // ── Suite F — ambiguous dispatch → UNKNOWN + STUCK_DISPATCH_TIMEOUT ───────
  describe("Suite F: ambiguous dispatch timeout", () => {
    it("stamps the STUCK_DISPATCH_TIMEOUT sentinel on an ambiguous delivery", async () => {
      harness.setWebhookMode("timeout");
      const { intentId, attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );

      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
      });
      expect(intent.status).toBe("ACTION_REQUIRED");
      expect(attempt.status).toBe("UNKNOWN");
      expect(attempt.sanitizedError).toMatch(/^STUCK_DISPATCH_TIMEOUT: /);
      expect(attempt.result).toMatchObject({
        outcome: "UNKNOWN",
        errorCode: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
        retryable: false,
      });
    }, 120_000);
  });

  // ── Suite G — replay / idempotency matrix (AC #3) ─────────────────────────
  describe("Suite G: replay protection & duplicate suppression", () => {
    beforeEach(() => {
      // Suite F leaves the webhook in "timeout" mode — every journey here
      // needs a responsive harness with a successful provider.
      harness.setWebhookMode("success");
      harness.setMetaProviderMode("success");
    });
    it("C1: duplicate BullMQ job resolves to the same attempt with one n8n call", async () => {
      harness.setMetaProviderMode("success");
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;
      const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
        method: "PUT",
        token: ownerToken,
        body: {
          scheduledLocalAt: cairoLocalIn(10),
          timezone: "Africa/Cairo",
          targetId: TARGET_ID,
          currentVersion: create.body.version,
          idempotencyKey: `schedule-${uuid()}`,
        },
      });
      expect(schedule.status).toBe(200);
      const version = schedule.body.version as number;
      const approveKey = `approve-dup-${uuid()}`;
      const approve = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
        method: "POST",
        token: ownerToken,
        body: {
          decision: "APPROVED",
          currentVersion: version,
          candidateChecksum: candidate.candidate_checksum,
          idempotencyKey: approveKey,
        },
      });
      expect(approve.status).toBe(201);

      // Force a SECOND BullMQ delivery of the same job data (different jobId
      // so both execute). The processor's per-key replay must resolve it to the
      // existing attempt as a recorded no-op.
      const dispatchQueue = app.get<Queue>(getQueueToken("publishing-dispatch"));
      const dispatchBefore = harness.dispatchCount;
      await dispatchQueue.add(
        "dispatch",
        {
          intentId,
          version,
          idempotencyKey: `${approveKey}::dispatch`,
        },
        { jobId: `publish-${intentId}-v${version}-stale-replay`, delay: 10_000 },
      );

      await waitFor(
        async () => {
          const intent = await prisma.publishingIntent.findUnique({
            where: { id: intentId },
          });
          return intent?.status === "SUCCEEDED";
        },
        60_000,
        750,
        `intent ${intentId} SUCCEEDED with duplicate job`,
      );

      const attempts = await prisma.publishingAttempt.count({
        where: { intentId },
      });
      const results = await prisma.publishingResult.count({
        where: { intentId },
      });
      expect(attempts).toBe(1);
      expect(results).toBe(1);
      expect(harness.dispatchCount).toBe(dispatchBefore + 1);
    }, 120_000);

    it("C3: a conflicting subsequent callback is rejected and cannot mutate the result", async () => {
      harness.setMetaProviderMode("success");
      const { attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );
      expect(attempt.result).toMatchObject({ outcome: "PUBLISHED" });

      const captured = harness.callbacksSent.find(
        (c) => (c.envelope as { body?: { attempt_id?: string } }).body?.attempt_id === attempt.id,
      )!.envelope as SignedPublicationCallbackEnvelopeV1;

      // A FAILED callback for the SAME attempt, new callback_id, still
      // signature-valid and attempt-bound → must 409, result untouched.
      const conflicting = resignCallback(captured, (body) => {
        body.callback_id = uuid();
        body.result = {
          ...body.result,
          result_id: uuid(),
          outcome: "failed",
          provider: "meta",
          remote_publication_id: null,
          remote_url: null,
          export_artifact_id: null,
          simulation_reference_id: null,
          simulation_label: null,
          error_code: "PUBLISHING_PROVIDER_FAILURE",
          retryable: false,
          reconciliation_required: false,
        } as PublicationResultV1;
      });
      const rejected = await api(
        `/internal/v1/publishing/dispatch/${attempt.id}/callback`,
        { method: "POST", body: conflicting },
      );
      expect(rejected.status).toBe(409);
      expect(rejected.body.message).toContain("PUBLISHING_CALLBACK_CONFLICT");

      const after = await prisma.publishingResult.findUnique({
        where: { attemptId: attempt.id },
      });
      expect(after).toMatchObject({
        outcome: "PUBLISHED",
        remotePublicationId: "post-123",
      });
    }, 120_000);

    it("C4: callback signed for attempt A cannot be posted to attempt B's URL", async () => {
      harness.setMetaProviderMode("success");
      const { attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );
      const captured = harness.callbacksSent.find(
        (c) => (c.envelope as { body?: { attempt_id?: string } }).body?.attempt_id === attempt.id,
      )!.envelope;

      const otherAttemptId = uuid();
      const response = await api(
        `/internal/v1/publishing/dispatch/${otherAttemptId}/callback`,
        { method: "POST", body: captured },
      );
      expect(response.status).toBe(401);
      expect(response.body.message).toContain("PUBLISHING_WEBHOOK_UNAUTHORIZED");
    }, 120_000);

    it("C5: a callback with an out-of-window timestamp is rejected", async () => {
      harness.setMetaProviderMode("success");
      const { attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );
      const captured = harness.callbacksSent.find(
        (c) => (c.envelope as { body?: { attempt_id?: string } }).body?.attempt_id === attempt.id,
      )!.envelope as SignedPublicationCallbackEnvelopeV1;

      const stale = resignCallback(captured, () => {}, {
        sentAt: new Date(Date.now() + 400_000).toISOString(),
      });
      const response = await api(
        `/internal/v1/publishing/dispatch/${attempt.id}/callback`,
        { method: "POST", body: stale },
      );
      expect(response.status).toBe(401);
      expect(response.body.message).toContain(
        "PUBLISHING_WEBHOOK_TIMESTAMP_INVALID",
      );
    }, 120_000);

    it("C6: a callback with a corrupted signature is rejected", async () => {
      harness.setMetaProviderMode("success");
      const { attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );
      const captured = harness.callbacksSent.find(
        (c) => (c.envelope as { body?: { attempt_id?: string } }).body?.attempt_id === attempt.id,
      )!.envelope as SignedPublicationCallbackEnvelopeV1;

      const corrupted = structuredClone(captured) as any;
      corrupted.signature =
        (corrupted.signature[0] === "0" ? "1" : "0") + corrupted.signature.slice(1);
      const response = await api(
        `/internal/v1/publishing/dispatch/${attempt.id}/callback`,
        { method: "POST", body: corrupted },
      );
      expect(response.status).toBe(401);
      expect(response.body.message).toContain("PUBLISHING_WEBHOOK_UNAUTHORIZED");
    }, 120_000);

    it("C7: the partial unique index enforces one PUBLISHED result per intent", async () => {
      harness.setMetaProviderMode("success");
      const { intentId, attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );
      expect(attempt.result).toMatchObject({ outcome: "PUBLISHED" });

      // A second attempt row for the same intent+version (fresh key), then a
      // second PUBLISHED result must hit the partial unique index.
      const secondAttempt = await prisma.publishingAttempt.create({
        data: {
          intentId,
          intentVersion: attempt.intentVersion,
          attemptSequence: attempt.attemptSequence + 1,
          status: "QUEUED",
          idempotencyKey: `db-level-dup-${uuid()}`,
          startedAt: new Date(),
        },
      });
      let createError: { message?: string; meta?: { constraint?: string } } | null =
        null;
      try {
        // Raw insert so the Postgres violation surfaces (Prisma model P2002
        // meta only carries the target field list).
        await prisma.$queryRaw`
          INSERT INTO publishing_results (
            id, attempt_id, intent_id, outcome, provider, remote_publication_id,
            remote_url, retryable, raw_payload_hash, occurred_at, created_at
          ) VALUES (
            ${uuid()}::uuid, ${secondAttempt.id}::uuid, ${intentId}::uuid,
            'PUBLISHED', 'META', 'post-dup', 'https://facebook.example/post-dup',
            false, ${uuid().replace(/-/g, "")}, now(), now()
          )
        `;
      } catch (err) {
        createError = err as { message?: string; meta?: { constraint?: string } };
      }
      // The second PUBLISHED result for the SAME intent must violate the
      // partial unique index: PG reports 23505 on (intent_id) — the only
      // intent_id-only unique constraint is the partial published index.
      expect(createError).not.toBeNull();
      expect(createError?.message ?? "").toContain("23505");
      expect(createError?.message ?? "").toContain("(intent_id)");
      const partialIndex = await prisma.$queryRaw<
        Array<{ indexname: string }>
      >`SELECT indexname FROM pg_indexes WHERE indexname = 'publishing_results_intent_id_published_uniq'`;
      expect(partialIndex).toHaveLength(1);
    }, 120_000);
  });

  // ── Suite H — stale jobs / reschedule / expiry / asset integrity ──────────
  describe("Suite H: reschedule invalidation & pre-call guards", () => {
    beforeEach(() => {
      harness.setWebhookMode("success");
      harness.setMetaProviderMode("success");
    });
    it("H1: reschedule invalidates the prior approval and a stale v1 job cannot dispatch", async () => {
      harness.setMetaProviderMode("success");
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;
      const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
        method: "PUT",
        token: ownerToken,
        body: {
          scheduledLocalAt: cairoLocalIn(10),
          timezone: "Africa/Cairo",
          targetId: TARGET_ID,
          currentVersion: create.body.version,
          idempotencyKey: `schedule-${uuid()}`,
        },
      });
      expect(schedule.status).toBe(200);
      const v1 = schedule.body.version as number;
      const approveKey = `approve-v1-${uuid()}`;
      const approve = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
        method: "POST",
        token: ownerToken,
        body: {
          decision: "APPROVED",
          currentVersion: v1,
          candidateChecksum: candidate.candidate_checksum,
          idempotencyKey: approveKey,
        },
      });
      expect(approve.status).toBe(201);

      // Reschedule BEFORE the v1 due-time: version bumps to v2, status returns
      // to AWAITING_APPROVAL, the v1 approval is invalidated.
      const reschedule = await api(
        `/api/v1/publication-intents/${intentId}/reschedule`,
        {
          method: "POST",
          token: ownerToken,
          body: {
            scheduledLocalAt: cairoLocalIn(30),
            timezone: "Africa/Cairo",
            targetId: TARGET_ID,
            currentVersion: v1,
            idempotencyKey: `reschedule-${uuid()}`,
          },
        },
      );
      expect(reschedule.status).toBe(201);
      expect(reschedule.body.version).toBe(v1 + 1);

      // Simulate a STALE v1 BullMQ delivery that survived the job removal
      // (stalled redelivery): the atomic intent claim WHERE id, v1 must abort
      // it before any n8n call.
      const dispatchQueue = app.get<Queue>(getQueueToken("publishing-dispatch"));
      const dispatchBefore = harness.dispatchCount;
      await dispatchQueue.add(
        "dispatch",
        {
          intentId,
          version: v1,
          idempotencyKey: `${approveKey}::dispatch`,
        },
        { jobId: `publish-${intentId}-v${v1}-stale`, delay: 2_000 },
      );

      // Let the stale job fire; the intent must stay AWAITING_APPROVAL with no
      // attempt and no n8n call.
      await new Promise((r) => setTimeout(r, 5_000));
      const mid = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { attempts: true },
      });
      expect(mid.status).toBe("AWAITING_APPROVAL");
      expect(mid.attempts).toHaveLength(0);
      expect(harness.dispatchCount).toBe(dispatchBefore);

      // Approve v2 → dispatches normally; exactly one attempt reaches success.
      const approveV2 = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
        method: "POST",
        token: ownerToken,
        body: {
          decision: "APPROVED",
          currentVersion: v1 + 1,
          candidateChecksum: candidate.candidate_checksum,
          idempotencyKey: `approve-v2-${uuid()}`,
        },
      });
      expect(approveV2.status).toBe(201);
      await waitFor(
        async () => {
          const intent = await prisma.publishingIntent.findUnique({
            where: { id: intentId },
          });
          return intent?.status === "SUCCEEDED";
        },
        60_000,
        750,
        `intent ${intentId} SUCCEEDED after reschedule`,
      );
      const attempts = await prisma.publishingAttempt.count({ where: { intentId } });
      const results = await prisma.publishingResult.count({ where: { intentId } });
      expect(attempts).toBe(1);
      expect(results).toBe(1);
      expect(harness.dispatchCount).toBe(dispatchBefore + 1);
    }, 120_000);

    it("H2: expired target discovered at dispatch blocks the provider call", async () => {
      harness.setMetaProviderMode("success");
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;
      const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
        method: "PUT",
        token: ownerToken,
        body: {
          scheduledLocalAt: cairoLocalIn(10),
          timezone: "Africa/Cairo",
          targetId: TARGET_ID,
          currentVersion: create.body.version,
          idempotencyKey: `schedule-${uuid()}`,
        },
      });
      expect(schedule.status).toBe(200);
      const version = schedule.body.version as number;
      const approve = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
        method: "POST",
        token: ownerToken,
        body: {
          decision: "APPROVED",
          currentVersion: version,
          candidateChecksum: candidate.candidate_checksum,
          idempotencyKey: `approve-${uuid()}`,
        },
      });
      expect(approve.status).toBe(201);

      // Flip the target EXPIRED between approval and the due-time job firing.
      await prisma.publishingTarget.update({
        where: { id: TARGET_ID },
        data: { connectionState: "EXPIRED" },
      });
      const dispatchBefore = harness.dispatchCount;
      try {
        await waitFor(
          async () => {
            const intent = await prisma.publishingIntent.findUnique({
              where: { id: intentId },
            });
            return intent?.status === "FAILED";
          },
          60_000,
          750,
          `intent ${intentId} FAILED at dispatch (expired target)`,
        );
        // The revalidation tx rejects BEFORE an attempt row is created, so the
        // intent FAILED is the visible recovery state and n8n was never called.
        const intent = await prisma.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
          include: { attempts: true },
        });
        expect(intent.attempts).toHaveLength(0);
        expect(harness.dispatchCount).toBe(dispatchBefore);
      } finally {
        await prisma.publishingTarget.update({
          where: { id: TARGET_ID },
          data: { connectionState: "CONNECTED" },
        });
      }
    }, 120_000);

    it("H3: asset mismatch fails the attempt BEFORE any provider call", async () => {
      harness.setMetaProviderMode("success");
      const candidate = buildCandidateWithAssetMismatch(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;
      const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
        method: "PUT",
        token: ownerToken,
        body: {
          scheduledLocalAt: cairoLocalIn(10),
          timezone: "Africa/Cairo",
          targetId: TARGET_ID,
          currentVersion: create.body.version,
          idempotencyKey: `schedule-${uuid()}`,
        },
      });
      expect(schedule.status).toBe(200);
      const version = schedule.body.version as number;
      const approve = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
        method: "POST",
        token: ownerToken,
        body: {
          decision: "APPROVED",
          currentVersion: version,
          candidateChecksum: candidate.candidate_checksum,
          idempotencyKey: `approve-${uuid()}`,
        },
      });
      expect(approve.status).toBe(201);

      const dispatchBefore = harness.dispatchCount;
      await waitFor(
        async () => {
          const intent = await prisma.publishingIntent.findUnique({
            where: { id: intentId },
          });
          return intent?.status === "FAILED";
        },
        60_000,
        750,
        `intent ${intentId} FAILED at dispatch (asset mismatch)`,
      );
      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { attempts: { include: { result: true } } },
      });
      expect(intent.attempts).toHaveLength(1);
      expect(intent.attempts[0].status).toBe("FAILED");
      expect(intent.attempts[0].sanitizedError).toContain(
        "PUBLISHING_ASSET_TAMPERED",
      );
      expect(intent.attempts[0].result).toBeNull();
      expect(harness.dispatchCount).toBe(dispatchBefore);
    }, 120_000);

    it("H4: candidate revoked after approval cascade-cancels the intent before dispatch", async () => {
      harness.setMetaProviderMode("success");
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;
      const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
        method: "PUT",
        token: ownerToken,
        body: {
          scheduledLocalAt: cairoLocalIn(10),
          timezone: "Africa/Cairo",
          targetId: TARGET_ID,
          currentVersion: create.body.version,
          idempotencyKey: `schedule-${uuid()}`,
        },
      });
      expect(schedule.status).toBe(200);
      const version = schedule.body.version as number;
      const approve = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
        method: "POST",
        token: ownerToken,
        body: {
          decision: "APPROVED",
          currentVersion: version,
          candidateChecksum: candidate.candidate_checksum,
          idempotencyKey: `approve-${uuid()}`,
        },
      });
      expect(approve.status).toBe(201);
      expect(
        (
          await prisma.publishingIntent.findUniqueOrThrow({
            where: { id: intentId },
          })
        ).status,
      ).toBe("SCHEDULED");

      // Revoke AFTER the approval. The ingest cascade (candidates.service.ts)
      // cancels every non-dispatched intent for the candidate, so the due-time
      // job is dead before it can fire.
      const revoked = await api(
        "/internal/v1/publishing/candidates/ingest",
        {
          method: "POST",
          internalToken,
          body: ingestEvent(
            {
              contract_version: "publication-candidate-status-v1",
              candidate_id: candidate.candidate_id,
              business_id: businessId,
              candidate_checksum: candidate.candidate_checksum,
              state_version: 2,
              candidate_state: "revoked",
              replacement_candidate_id: null,
              changed_by_user_id: uuid(),
              changed_at: new Date().toISOString(),
            } as any,
            { eventType: "content.publication_candidate.state_changed.v1" },
          ),
        },
      );
      expect(revoked.status).toBe(200);
      expect(revoked.body.disposition).toBe("applied");
      const intent = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { attempts: true },
      });
      expect(intent.status).toBe("CANCELLED");
      expect(intent.attempts).toHaveLength(0);

      // Let the (now stale) due-time job fire and prove it cannot dispatch.
      const scheduleFireAt = new Date(schedule.body.scheduledUtcAt);
      const dispatchBefore = harness.dispatchCount;
      await waitFor(
        async () => Date.now() >= scheduleFireAt.getTime(),
        60_000,
        1_000,
        `due time passed for intent ${intentId}`,
      );
      const after = await prisma.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { attempts: true },
      });
      expect(after.status).toBe("CANCELLED");
      expect(after.attempts).toHaveLength(0);
      expect(harness.dispatchCount).toBe(dispatchBefore);
    }, 120_000);

    it("H5: a candidate revoked behind the ingest path is still blocked at dispatch", async () => {
      harness.setMetaProviderMode("success");
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "REAL",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;
      const schedule = await api(`/api/v1/publication-intents/${intentId}/schedule`, {
        method: "PUT",
        token: ownerToken,
        body: {
          scheduledLocalAt: cairoLocalIn(10),
          timezone: "Africa/Cairo",
          targetId: TARGET_ID,
          currentVersion: create.body.version,
          idempotencyKey: `schedule-${uuid()}`,
        },
      });
      expect(schedule.status).toBe(200);
      const version = schedule.body.version as number;
      const approve = await api(`/api/v1/publication-intents/${intentId}/decisions`, {
        method: "POST",
        token: ownerToken,
        body: {
          decision: "APPROVED",
          currentVersion: version,
          candidateChecksum: candidate.candidate_checksum,
          idempotencyKey: `approve-${uuid()}`,
        },
      });
      expect(approve.status).toBe(201);

      // Flip the candidate REVOKED directly in the DB (bypassing the ingest
      // cascade) so the dispatch-time revalidation (§9.2 check 4) is the only
      // guard — it must abort before any n8n call.
      await prisma.publishingCandidate.update({
        where: { id: candidate.candidate_id },
        data: { status: "REVOKED" },
      });
      const dispatchBefore = harness.dispatchCount;
      try {
        await waitFor(
          async () => {
            const intent = await prisma.publishingIntent.findUnique({
              where: { id: intentId },
            });
            return intent?.status === "FAILED";
          },
          60_000,
          750,
          `intent ${intentId} FAILED at dispatch (candidate revoked post-approval)`,
        );
        const intent = await prisma.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
          include: { attempts: true },
        });
        expect(intent.attempts).toHaveLength(0);
        expect(harness.dispatchCount).toBe(dispatchBefore);
      } finally {
        await prisma.publishingCandidate.update({
          where: { id: candidate.candidate_id },
          data: { status: "ACTIVE" },
        });
      }
    }, 120_000);
  });

  // ── Suite I — negative guarantees (labels, tenants, providers) ────────────
  describe("Suite I: simulation label & tenant isolation negatives", () => {
    beforeEach(() => {
      harness.setWebhookMode("success");
      harness.setMetaProviderMode("success");
    });
    it("I1: rejects a callback claiming SIMULATED without the SIMULATION label", async () => {
      harness.setMetaProviderMode("success");
      const { attempt } = await publishJourney(
        buildCandidatePayload(businessId),
        { mode: "REAL", scheduleAheadSeconds: 10 },
      );
      const captured = harness.callbacksSent.find(
        (c) => (c.envelope as { body?: { attempt_id?: string } }).body?.attempt_id === attempt.id,
      )!.envelope as SignedPublicationCallbackEnvelopeV1;

      const unlabelled = resignCallback(captured, (body) => {
        body.callback_id = uuid();
        body.result = {
          ...body.result,
          result_id: uuid(),
          outcome: "simulated",
          mode: "simulation",
          provider: null,
          remote_publication_id: null,
          remote_url: null,
          export_artifact_id: null,
          simulation_reference_id: `simulation:${attempt.id}`,
          simulation_label: null,
          error_code: null,
          retryable: false,
          reconciliation_required: false,
        } as PublicationResultV1;
      });
      const response = await api(
        `/internal/v1/publishing/dispatch/${attempt.id}/callback`,
        { method: "POST", body: unlabelled },
      );
      expect(response.status).toBe(400);
      expect(response.body.message).toContain("PUBLISHING_CALLBACK_INVALID");
    }, 120_000);

    it("I2: a second tenant cannot download or read another tenant's export", async () => {
      // Seed a foreign owner + business (second tenant).
      const foreignOwner = await prisma.user.create({
        data: {
          email: `foreign-${uuid()}@marketmind.test`,
          password: "not-a-real-password-hash",
          roles: ["OWNER"],
          fullName: "Foreign Owner",
        },
      });
      const foreignBusiness = await prisma.business.create({
        data: {
          ownerUserId: foreignOwner.id,
          displayName: "Foreign Business",
          businessType: "retail",
          city: "Cairo",
          status: "active",
        },
      });
      const foreignToken = jwt.sign(
        { sub: foreignOwner.id, email: foreignOwner.email, roles: ["OWNER"] },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: "15m" },
      );

      // Build an export for the PRIMARY tenant.
      const candidate = buildCandidatePayload(businessId);
      await api(
        "/internal/v1/publishing/candidates/ingest",
        { method: "POST", body: ingestEvent(candidate), internalToken },
      );
      const create = await api("/api/v1/publication-intents", {
        method: "POST",
        token: ownerToken,
        body: {
          candidateId: candidate.candidate_id,
          mode: "MANUAL_EXPORT",
          idempotencyKey: `create-${uuid()}`,
        },
      });
      expect(create.status).toBe(201);
      const intentId = create.body.id;
      const exported = await api(`/api/v1/publication-intents/${intentId}/dispatch-export`, {
        method: "POST",
        token: ownerToken,
        body: { idempotencyKey: `export-${uuid()}` },
      });
      expect(exported.status).toBe(201);

      // Foreign tenant must be denied (no enumeration: 403 fail-closed).
      const foreignMeta = await api(`/api/v1/publication-intents/${intentId}/export`, {
        token: foreignToken,
      });
      expect(foreignMeta.status).toBe(403);
      const foreignDownload = await api(
        `/api/v1/publication-intents/${intentId}/export/download`,
        { token: foreignToken },
      );
      expect(foreignDownload.status).toBe(403);
      expect(foreignDownload.body.message).toContain("PUBLISHING_FORBIDDEN");
    }, 60_000);
  });
});
