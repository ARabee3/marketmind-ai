import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";

import { configuration } from "../src/config/configuration";
import { envSchema } from "../src/config/env.schema";
import { AuthModule } from "../src/modules/auth/auth.module";
import { RbacModule } from "../src/modules/rbac/rbac.module";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { AuditModule } from "../src/modules/audit/audit.module";
import { AdminController } from "../src/modules/publishing/admin/admin.controller";
import { ReconciliationService } from "../src/modules/publishing/scheduling/reconciliation.service";

const TEST_ACCESS_SECRET = "test-access-secret";
process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:3001/api/v1/auth/google/callback";
process.env.FB_APP_ID = "test-facebook-app-id";
process.env.FB_APP_SECRET = "test-facebook-app-secret";
process.env.FB_REDIRECT_URI =
  "http://localhost:3001/api/v1/auth/facebook/callback";
process.env.TOKEN_ENCRYPTION_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://marketmind:marketmind_dev@localhost:5432/marketmind_dev?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

describe("Publishing Admin (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let adminToken: string;
  let devDemoToken: string;

  const TEST_EMAIL = "publishing-admin-e2e@test.local";
  const TEST_SMALL_TEXT_REF = `pae-${Date.now()}`;
  let ownerId = "";
  let businessId = "";
  let candidateId = "";
  let scheduledCandidateId = "";
  let targetId = "";
  let intentId = "";
  let attemptId = "";
  let unknownResultId = "";
  let publishedResultId = "";
  let scheduledIntentId = "";

  const fakeQueue = {
    getJob: jest.fn(async () => null),
    add: jest.fn(async () => ({})),
    getDelayed: jest.fn(async () => []),
    remove: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          validate: envSchema,
        }),
        AuthModule,
        RbacModule,
        AuditModule,
      ],
      controllers: [AdminController],
      providers: [
        ReconciliationService,
        {
          provide: "BullQueue_publishing-dispatch",
          useValue: fakeQueue,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const jwtService = app.get(JwtService);
    ownerToken = await jwtService.signAsync(
      { sub: "owner-user-id", email: "owner@e2e.test", roles: [Role.OWNER] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    adminToken = await jwtService.signAsync(
      {
        sub: "00000000-0000-4000-8000-000000000001",
        email: "admin@e2e.test",
        roles: [Role.ADMIN],
      },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    devDemoToken = await jwtService.signAsync(
      { sub: "dev-user-id", email: "dev@e2e.test", roles: [Role.DEVELOPER_DEMO] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );

    await seedPublishingChain();
  });

  afterAll(async () => {
    await cleanupSeedData();
    await app.close();
  });

  async function seedPublishingChain() {
    await cleanupSeedData();

    const owner = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        password: "test-password",
        isEmailVerified: true,
        roles: [Role.OWNER],
      },
    });
    ownerId = owner.id;

    const business = await prisma.business.create({
      data: {
        ownerUserId: owner.id,
        displayName: "Publishing Admin E2E",
        businessType: "retail",
        city: "Cairo",
      },
    });
    businessId = business.id;

    const candidate = await prisma.publishingCandidate.create({
      data: {
        businessId,
        externalContentId: `${TEST_SMALL_TEXT_REF}-content`,
        candidateChecksum: "pae-checksum",
        eventFingerprint: `pae-fp-${TEST_SMALL_TEXT_REF}`,
        eventId: "00000000-0000-4000-8000-0000000000aa",
        sourceStatus: { candidate_state: "active", state_version: 1 },
        payload: { title: "E2E post" },
        channel: "facebook",
        format: "static_image",
      },
    });
    candidateId = candidate.id;

    const target = await prisma.publishingTarget.create({
      data: {
        businessId,
        provider: "META",
        channel: "facebook",
        externalAccountId: `page-${TEST_SMALL_TEXT_REF}`,
        displayName: "E2E Page",
        credentialRef: "test-credential-ref",
        capabilities: ["static_image", "text"],
      },
    });
    targetId = target.id;

    const intent = await prisma.publishingIntent.create({
      data: {
        businessId,
        candidateId,
        targetId,
        status: "ACTION_REQUIRED",
        mode: "REAL",
        scheduledUtcAt: new Date(Date.now() - 60_000),
        createdByUserId: owner.id,
        idempotencyKey: `pae-intent-${TEST_SMALL_TEXT_REF}`,
      },
    });
    intentId = intent.id;

    const scheduledCandidate = await prisma.publishingCandidate.create({
      data: {
        businessId,
        externalContentId: `${TEST_SMALL_TEXT_REF}-scheduled-content`,
        candidateChecksum: "pae-checksum-scheduled",
        eventFingerprint: `pae-fp-scheduled-${TEST_SMALL_TEXT_REF}`,
        eventId: "00000000-0000-4000-8000-0000000000ab",
        sourceStatus: { candidate_state: "active", state_version: 1 },
        payload: { title: "E2E scheduled post" },
        channel: "facebook",
        format: "static_image",
      },
    });

    scheduledCandidateId = scheduledCandidate.id;

    const scheduledIntent = await prisma.publishingIntent.create({
      data: {
        businessId,
        candidateId: scheduledCandidate.id,
        targetId,
        status: "SCHEDULED",
        mode: "REAL",
        scheduledUtcAt: new Date(Date.now() + 60_000),
        createdByUserId: owner.id,
        idempotencyKey: `pae-scheduled-${TEST_SMALL_TEXT_REF}`,
      },
    });
    scheduledIntentId = scheduledIntent.id;

    const attempt = await prisma.publishingAttempt.create({
      data: {
        intentId,
        intentVersion: intent.version,
        attemptSequence: 1,
        idempotencyKey: `pae-attempt-${TEST_SMALL_TEXT_REF}`,
        status: "UNKNOWN",
        sanitizedError: "Stuck in QUEUED/DISPATCHING past timeout",
        startedAt: new Date(Date.now() - 120_000),
        finishedAt: new Date(Date.now() - 60_000),
      },
    });
    attemptId = attempt.id;

    const unknownResult = await prisma.publishingResult.create({
      data: {
        attemptId,
        intentId,
        outcome: "UNKNOWN",
        provider: "meta",
        errorCode: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
        retryable: false,
        sanitizedError: "Delivery outcome unknown — requires reconciliation",
        occurredAt: new Date(Date.now() - 60_000),
      },
    });
    unknownResultId = unknownResult.id;

    const publishedAttempt = await prisma.publishingAttempt.create({
      data: {
        intentId: scheduledIntent.id,
        intentVersion: scheduledIntent.version,
        attemptSequence: 1,
        idempotencyKey: `pae-published-attempt-${TEST_SMALL_TEXT_REF}`,
        status: "SUCCEEDED",
      },
    });
    const publishedResult = await prisma.publishingResult.create({
      data: {
        attemptId: publishedAttempt.id,
        intentId: scheduledIntent.id,
        outcome: "PUBLISHED",
        provider: "meta",
        remotePublicationId: "pae-remote-1",
        occurredAt: new Date(Date.now() - 30_000),
      },
    });
    publishedResultId = publishedResult.id;
  }

  async function cleanupSeedData() {
    if (publishedResultId) {
      const publishedAttemptId = (
        await prisma.publishingResult.findUnique({
          where: { id: publishedResultId },
          select: { attemptId: true },
        })
      )?.attemptId;
      await prisma.publishingResult.deleteMany({
        where: { id: publishedResultId },
      });
      if (publishedAttemptId) {
        await prisma.publishingAttempt.deleteMany({
          where: { id: publishedAttemptId },
        });
      }
      publishedResultId = "";
    }
    if (unknownResultId) {
      await prisma.publishingResult.deleteMany({
        where: { id: unknownResultId },
      });
      unknownResultId = "";
    }
    if (attemptId) {
      await prisma.publishingAttempt.deleteMany({ where: { id: attemptId } });
      attemptId = "";
    }
    if (intentId) {
      await prisma.publishingIntent.deleteMany({ where: { id: intentId } });
      intentId = "";
    }
    if (scheduledIntentId) {
      await prisma.publishingIntent.deleteMany({
        where: { id: scheduledIntentId },
      });
      scheduledIntentId = "";
    }
    if (targetId) {
      await prisma.publishingTarget.deleteMany({ where: { id: targetId } });
      targetId = "";
    }
    if (candidateId) {
      await prisma.publishingCandidate.deleteMany({
        where: { id: candidateId },
      });
      candidateId = "";
    }
    if (scheduledCandidateId) {
      await prisma.publishingCandidate.deleteMany({
        where: { id: scheduledCandidateId },
      });
      scheduledCandidateId = "";
    }
    if (businessId) {
      await prisma.business.deleteMany({ where: { id: businessId } });
      businessId = "";
    }
    if (ownerId) {
      await prisma.user.deleteMany({ where: { id: ownerId } });
      ownerId = "";
    }
  }

  describe("GET /publishing/admin/results authorization", () => {
    it("rejects anonymous access with 401", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/publishing/admin/results")
        .expect(401);
    });

    it("rejects OWNER access with 403", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/publishing/admin/results")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("rejects DEVELOPER_DEMO access with 403", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/publishing/admin/results")
        .set("Authorization", `Bearer ${devDemoToken}`)
        .expect(403);
    });

    it("allows ADMIN to list results", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/publishing/admin/results")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("page");
      expect(res.body).toHaveProperty("pageSize");
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(2);

      const unknown = res.body.items.find(
        (r: { id: string }) => r.id === unknownResultId,
      );
      expect(unknown).toBeTruthy();
      expect(unknown.intent).toHaveProperty("businessId", businessId);
      expect(unknown.intent.business).toHaveProperty(
        "displayName",
        "Publishing Admin E2E",
      );
      expect(unknown.attempt).toHaveProperty("status", "UNKNOWN");
    });

    it("filters results by outcome=UNKNOWN", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/publishing/admin/results?outcome=UNKNOWN")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.outcome).toBe("UNKNOWN");
      }
      const ids = res.body.items.map((r: { id: string }) => r.id);
      expect(ids).toContain(unknownResultId);
      expect(ids).not.toContain(publishedResultId);
    });

    it("rejects an invalid outcome filter with 400", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/publishing/admin/results?outcome=MAYBE")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("paginates results", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/publishing/admin/results?page=1&pageSize=1")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(1);
      expect(res.body.items).toHaveLength(1);
    });
  });

  describe("POST /publishing/admin/results/:resultId/resolve", () => {
    it("rejects anonymous resolve with 401", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/publishing/admin/results/${unknownResultId}/resolve`)
        .send({ resolution: "FAILED", reason: "e2e" })
        .expect(401);
    });

    it("rejects OWNER resolve with 403", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/publishing/admin/results/${unknownResultId}/resolve`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ resolution: "FAILED", reason: "e2e" })
        .expect(403);
    });

    it("rejects resolving as PUBLISHED without provider proof with 400", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/publishing/admin/results/${unknownResultId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ resolution: "PUBLISHED", reason: "e2e" })
        .expect(400);
    });

    it("resolves an UNKNOWN result as FAILED with a reason", async () => {
      await seedPublishingChain();
      await request(app.getHttpServer())
        .post(`/api/v1/publishing/admin/results/${unknownResultId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ resolution: "FAILED", reason: "manual reconciliation" })
        .expect(201);

      const db = await prisma.publishingResult.findUnique({
        where: { id: unknownResultId },
      });
      expect(db?.outcome).toBe("FAILED");
      expect(db?.sanitizedError).toBe("manual reconciliation");

      const intent = await prisma.publishingIntent.findUnique({
        where: { id: intentId },
      });
      expect(intent?.status).toBe("FAILED");

      const auditEntry = await prisma.auditLog.findFirst({
        where: { targetId: unknownResultId, action: "publishing.resolve_failed" },
      });
      expect(auditEntry).toBeTruthy();
      expect(auditEntry?.reason).toBe("manual reconciliation");
      expect(auditEntry?.beforeState).toEqual({ outcome: "UNKNOWN" });
      expect(auditEntry?.afterState).toEqual({
        outcome: "FAILED",
        remotePublicationId: null,
      });
    });

    it("resolves an UNKNOWN result as PUBLISHED with provider proof", async () => {
      await seedPublishingChain();
      await request(app.getHttpServer())
        .post(`/api/v1/publishing/admin/results/${unknownResultId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          resolution: "PUBLISHED",
          reason: "confirmed on the provider dashboard",
          remotePublicationId: "provider-page-post-42",
        })
        .expect(201);

      const db = await prisma.publishingResult.findUnique({
        where: { id: unknownResultId },
      });
      expect(db?.outcome).toBe("PUBLISHED");
      expect(db?.remotePublicationId).toBe("provider-page-post-42");

      const intent = await prisma.publishingIntent.findUnique({
        where: { id: intentId },
      });
      expect(intent?.status).toBe("SUCCEEDED");

      const auditEntry = await prisma.auditLog.findFirst({
        where: { targetId: unknownResultId, action: "publishing.resolve_published" },
      });
      expect(auditEntry).toBeTruthy();
      expect(auditEntry?.reason).toBe("confirmed on the provider dashboard");
      expect(auditEntry?.afterState).toEqual({
        outcome: "PUBLISHED",
        remotePublicationId: "provider-page-post-42",
      });
    });

    it("rejects resolving a non-UNKNOWN result with 400", async () => {
      await seedPublishingChain();
      await request(app.getHttpServer())
        .post(`/api/v1/publishing/admin/results/${publishedResultId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ resolution: "FAILED", reason: "e2e" })
        .expect(400);
    });

    it("returns 404 for a missing result", async () => {
      await request(app.getHttpServer())
        .post(
          "/api/v1/publishing/admin/results/00000000-0000-4000-8000-0000000000ff/resolve",
        )
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ resolution: "FAILED", reason: "e2e" })
        .expect(404);
    });
  });

  describe("POST /publishing/admin/sweep", () => {
    it("rejects anonymous sweep with 401", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/publishing/admin/sweep")
        .expect(401);
    });

    it("rejects OWNER sweep with 403", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/publishing/admin/sweep")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("allows ADMIN to trigger a sweep", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/publishing/admin/sweep")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body).toHaveProperty("ok", true);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: "publishing.sweep" },
        orderBy: { createdAt: "desc" },
      });
      expect(auditEntry).toBeTruthy();
      expect(auditEntry?.actorEmail).toBe("admin@e2e.test");
    });
  });

  describe("POST /publishing/admin/intents/:intentId/resync-schedule", () => {
    it("allows ADMIN to resync a SCHEDULED intent", async () => {
      await seedPublishingChain();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/publishing/admin/intents/${scheduledIntentId}/resync-schedule`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body).toHaveProperty("queued", true);
      expect(fakeQueue.add).toHaveBeenCalled();

      const auditEntry = await prisma.auditLog.findFirst({
        where: { targetId: scheduledIntentId, action: "publishing.resync_schedule" },
      });
      expect(auditEntry).toBeTruthy();
      expect(auditEntry?.beforeState).toHaveProperty("id", scheduledIntentId);
    });
  });
});