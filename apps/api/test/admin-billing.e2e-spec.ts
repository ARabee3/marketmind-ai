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
import { AdminModule } from "../src/modules/admin/admin.module";
import { BillingModule } from "../src/modules/billing/billing.module";
import { BillingService } from "../src/modules/billing/billing.service";

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
  "postgresql://marketmind:marketmind_dev@127.0.0.1:5433/marketmind_dev?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

describe("Admin Billing (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let billingService: BillingService;
  let ownerToken: string;
  let adminToken: string;

  let testUserId: string;
  let testAccountId: string;

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
        AdminModule,
        BillingModule,
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
    billingService = app.get(BillingService);

    const jwtService = app.get(JwtService);
    testUserId = "00000000-0000-4000-8000-000000000099";

    // Ensure a test user exists in DB
    await prisma.user.upsert({
      where: { id: testUserId },
      update: {},
      create: {
        id: testUserId,
        email: "billing-e2e-user@example.com",
        password: "hash",
        fullName: "Billing E2E User",
        roles: [Role.OWNER],
        status: "ACTIVE",
      },
    });

    const adminUserId = "00000000-0000-4000-8000-000000000001";
    await prisma.user.upsert({
      where: { id: adminUserId },
      update: {},
      create: {
        id: adminUserId,
        email: "admin@e2e.test",
        password: "hash",
        fullName: "E2E Admin",
        roles: [Role.ADMIN],
        status: "ACTIVE",
      },
    });

    ownerToken = await jwtService.signAsync(
      { sub: testUserId, email: "billing-e2e-user@example.com", roles: [Role.OWNER] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    adminToken = await jwtService.signAsync(
      {
        sub: adminUserId,
        email: "admin@e2e.test",
        roles: [Role.ADMIN],
      },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );

    // Get or create test billing account
    const wallet = await billingService.getWallet(testUserId);
    testAccountId = wallet.billing_account_id;
  });

  afterAll(async () => {
    // Restore billing account to active if modified
    if (testAccountId) {
      await prisma.billingAccount.update({
        where: { id: testAccountId },
        data: { status: "active", pausedReason: null, pausedAt: null },
      }).catch(() => {});
    }
    await app.close();
  });

  describe("GET /admin/billing/cost-alerts", () => {
    it("returns 401 for unauthenticated caller", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/billing/cost-alerts")
        .expect(401);
    });

    it("returns 403 for non-admin user", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/billing/cost-alerts")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("returns cost alert summary for admin", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/billing/cost-alerts")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("alerts");
      expect(res.body).toHaveProperty("totalAccountsAboveEgp50");
      expect(res.body).toHaveProperty("totalHighRetryArtifacts");
    });
  });

  describe("GET /admin/billing/reconciliation", () => {
    it("returns reconciliation mismatches for admin", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/billing/reconciliation")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /admin/billing/accounts", () => {
    it("returns 401 for unauthenticated caller", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/billing/accounts")
        .expect(401);
    });

    it("returns 403 for non-admin user", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/billing/accounts")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("lists billing accounts with the test account included", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/billing/accounts?search=billing-e2e-user`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0]).toHaveProperty("ownerEmail");
      expect(res.body.items[0]).toHaveProperty("status");
    });

    it("filters paused accounts by status", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/billing/accounts?status=active")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.every((item: { status: string }) => item.status === "active")).toBe(true);
    });
  });

  describe("GET /admin/billing/wallets/overview", () => {
    it("returns 401 for unauthenticated caller", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/billing/wallets/overview")
        .expect(401);
    });

    it("returns 403 for non-admin user", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/billing/wallets/overview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("returns aggregated wallet totals for admin", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/billing/wallets/overview")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("totalAccounts");
      expect(res.body).toHaveProperty("activeAccounts");
      expect(res.body).toHaveProperty("totalPointsOutstanding");
      expect(res.body).toHaveProperty("totalTopUpEgp");
      expect(res.body.totalAccounts).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /admin/billing/wallets", () => {
    it("lists wallets with balance rows", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/billing/wallets?search=billing-e2e-user")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0]).toHaveProperty("balance");
      expect(res.body.items[0]).toHaveProperty("lifetimeGranted");
    });
  });

  describe("GET /admin/billing/wallets/:id/ledger", () => {
    it("returns ledger rows for the test account", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/billing/wallets/${testAccountId}/ledger`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it("returns 400 for a non-uuid account id", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/billing/wallets/not-a-uuid/ledger")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  describe("POST /admin/billing/wallets/:id/top-up", () => {
    it("returns 401 for unauthenticated caller", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/billing/wallets/${testAccountId}/top-up`)
        .send({ points: 50, reason: "e2e topup" })
        .expect(401);
    });

    it("returns 403 for non-admin user", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/billing/wallets/${testAccountId}/top-up`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ points: 50, reason: "e2e topup" })
        .expect(403);
    });

    it("rejects non-positive points with 400", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/billing/wallets/${testAccountId}/top-up`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ points: 0, reason: "e2e topup" })
        .expect(400);
    });

    it("credits the wallet and records an audit entry", async () => {
      const before = await prisma.billingPointBalance.findUnique({
        where: { billingAccountId: testAccountId },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/billing/wallets/${testAccountId}/top-up`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ points: 50, reason: "e2e manual correction" })
        .expect(201);

      expect(res.body).toHaveProperty("balance");
      expect(res.body.balance).toBe((before?.balance ?? 0) + 50);

      const ledger = await prisma.billingPointLedger.findFirst({
        where: { billingAccountId: testAccountId, claimKey: { startsWith: "admin:topup:" } },
        orderBy: { createdAt: "desc" },
      });
      expect(ledger).toBeTruthy();
      expect(ledger?.direction).toBe("credit");
      expect(ledger?.reason).toBe("topup");
      expect(ledger?.points).toBe(50);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { targetId: testAccountId, action: "billing.wallet_topup" },
        orderBy: { createdAt: "desc" },
      });
      expect(auditEntry).toBeTruthy();
      expect(auditEntry?.reason).toBe("e2e manual correction");
      expect(auditEntry?.beforeState).toEqual({
        balance: before?.balance ?? 0,
        lifetimeGranted: before?.lifetimeGranted ?? 0,
      });
      expect(auditEntry?.afterState).toHaveProperty("balance");
    });
  });

  describe("GET /admin/billing/transactions", () => {
    it("lists wallet top-up transactions", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/billing/transactions")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe("number");
    });
  });

  describe("POST /admin/billing/accounts/:id/pause and /resume", () => {
    it("returns 404 for missing account", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/billing/accounts/00000000-0000-4000-8000-000000000999/pause")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Testing non-existent" })
        .expect(404);
    });

    it("pauses the account and blocks points spending", async () => {
      const pauseRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/billing/accounts/${testAccountId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Suspicious activity detected" })
        .expect(201);

      expect(pauseRes.body).toMatchObject({
        id: testAccountId,
        status: "paused",
        pausedReason: "Suspicious activity detected",
      });

      // Verify audit log entry was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetId: testAccountId,
          action: "billing.pause",
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.reason).toBe("Suspicious activity detected");

      // Verify spending points fails when paused
      await expect(
        billingService.spendPoints(testUserId, "content_item", 1, `e2e-claim-${Date.now()}`),
      ).rejects.toThrow("This billing account is paused by an operator.");
    });

    it("resumes the account and restores points spending", async () => {
      const resumeRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/billing/accounts/${testAccountId}/resume`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(resumeRes.body).toMatchObject({
        id: testAccountId,
        status: "active",
        pausedReason: null,
      });

      // Verify audit log entry was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetId: testAccountId,
          action: "billing.resume",
        },
      });
      expect(auditLog).not.toBeNull();

      // Spending points should work again
      await expect(
        billingService.spendPoints(testUserId, "content_item", 1, `e2e-claim-${Date.now()}`),
      ).resolves.not.toThrow();
    });
  });
});
