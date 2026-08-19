import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";

import { configuration } from "../src/config/configuration";
import { envSchema } from "../src/config/env.schema";
import { AuthModule } from "../src/modules/auth/auth.module";
import { RbacModule } from "../src/modules/rbac/rbac.module";
import { AdminModule } from "../src/modules/admin/admin.module";
import { PrismaService } from "../src/common/persistence/prisma.service";

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

describe("Admin (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let adminToken: string;
  let devDemoToken: string;

  const TEST_EMAILS = [
    "admin-e2e-unverified@test.local",
    "admin-e2e-suspended@test.local",
    "admin-e2e-owner@test.local",
  ];
  let testPriceCode: string;
  let testAccountId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: envSchema }),
        AuthModule,
        RbacModule,
        AdminModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    prisma = app.get(PrismaService);

    const jwtService = app.get(JwtService);
    ownerToken = await jwtService.signAsync(
      { sub: "owner-user-id", email: "owner@e2e.test", roles: [Role.OWNER] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    adminToken = await jwtService.signAsync(
      { sub: "admin-user-id", email: "admin@e2e.test", roles: [Role.ADMIN] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    devDemoToken = await jwtService.signAsync(
      { sub: "dev-user-id", email: "dev@e2e.test", roles: [Role.DEVELOPER_DEMO] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
  });

  afterAll(async () => {
    await cleanupSeedData();
    await app.close();
  });

  async function seedAttentionData() {
    await cleanupSeedData();
    const unverified = await prisma.user.create({
      data: {
        email: TEST_EMAILS[0],
        password: "test-password",
        isEmailVerified: false,
        status: "active",
      },
    });
    const suspended = await prisma.user.create({
      data: {
        email: TEST_EMAILS[1],
        password: "test-password",
        isEmailVerified: false,
        status: "suspended",
      },
    });
    const owner = await prisma.user.create({
      data: {
        email: TEST_EMAILS[2],
        password: "test-password",
        isEmailVerified: true,
        status: "active",
      },
    });
    testPriceCode = `admin-e2e-${Date.now()}`;
    const price = await prisma.billingPrice.create({
      data: {
        code: testPriceCode,
        planCode: "growth",
        interval: "monthly",
        amountEgp: 299,
        periodDays: 30,
        displayNameEn: "Admin e2e",
        displayNameAr: "اختبار",
      },
    });
    const account = await prisma.billingAccount.create({
      data: { ownerUserId: owner.id },
    });
    testAccountId = account.id;
    await prisma.billingSubscription.createMany({
      data: [
        { billingAccountId: account.id, priceId: price.id, state: "past_due" },
        { billingAccountId: account.id, priceId: price.id, state: "expired" },
      ],
    });
    return { unverified, suspended };
  }

  async function cleanupSeedData() {
    if (testAccountId) {
      await prisma.billingSubscription.deleteMany({
        where: { billingAccountId: testAccountId },
      });
      await prisma.billingAccount.deleteMany({
        where: { id: testAccountId },
      });
      testAccountId = "";
    }
    if (testPriceCode) {
      await prisma.billingPrice.deleteMany({ where: { code: testPriceCode } });
      testPriceCode = "";
    }
    await prisma.user.deleteMany({ where: { email: { in: TEST_EMAILS } } });
  }

  describe("authorization matrix", () => {
    const adminEndpoints = [
      { method: "get" as const, path: "/api/v1/admin/users", label: "GET /admin/users" },
      { method: "get" as const, path: "/api/v1/admin/users/00000000-0000-0000-0000-000000000001", label: "GET /admin/users/:id" },
      { method: "get" as const, path: "/api/v1/admin/revenue/summary", label: "GET /admin/revenue/summary" },
      { method: "get" as const, path: "/api/v1/admin/subscriptions", label: "GET /admin/subscriptions" },
    ];

    it.each(adminEndpoints)(
      "rejects anonymous access to $label with 401",
      async ({ method, path }) => {
        await request(app.getHttpServer()).get(path).expect(401);
      },
    );

    it.each(adminEndpoints)(
      "rejects OWNER access to $label with 403",
      async ({ method, path }) => {
        await request(app.getHttpServer())
          .get(path)
          .set("Authorization", `Bearer ${ownerToken}`)
          .expect(403);
      },
    );

    it.each(adminEndpoints)(
      "rejects DEVELOPER_DEMO access to $label with 403",
      async ({ method, path }) => {
        await request(app.getHttpServer())
          .get(path)
          .set("Authorization", `Bearer ${devDemoToken}`)
          .expect(403);
      },
    );
  });

  describe("ADMIN access to admin endpoints", () => {
    it("allows ADMIN to get users list", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("page");
      expect(res.body).toHaveProperty("pageSize");
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(20);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it("allows ADMIN to get users with pagination params", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/users?page=2&pageSize=5")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.page).toBe(2);
      expect(res.body.pageSize).toBe(5);
    });

    it("allows ADMIN to get users with search param", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/users?search=nonexistentuser")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it("returns 404 for missing user with valid UUID", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/users/00000000-0000-0000-0000-000000000001")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });

    it("allows ADMIN to get revenue summary", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/revenue/summary")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toHaveProperty("activeBusinesses");
      expect(res.body).toHaveProperty("activeSubscriptions");
      expect(res.body).toHaveProperty("trialingCount");
      expect(res.body).toHaveProperty("mrrEgp");
      expect(res.body).toHaveProperty("pastDueSubscriptions");
      expect(res.body).toHaveProperty("expiredSubscriptions");
      expect(res.body).toHaveProperty("unverifiedUsers");
      expect(typeof res.body.activeBusinesses).toBe("number");
      expect(typeof res.body.activeSubscriptions).toBe("number");
      expect(typeof res.body.trialingCount).toBe("number");
      expect(typeof res.body.mrrEgp).toBe("number");
      // typeof Infinity === "number"; only Number.isFinite rejects it after JSON round-trip (null).
      expect(Number.isFinite(res.body.mrrEgp)).toBe(true);
      expect(typeof res.body.pastDueSubscriptions).toBe("number");
      expect(typeof res.body.expiredSubscriptions).toBe("number");
      expect(typeof res.body.unverifiedUsers).toBe("number");
    });

    it("allows ADMIN to get subscriptions list", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/subscriptions")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it("matches needs-attention counts against the database and excludes suspended unverified users", async () => {
      await seedAttentionData();

      const expectedPastDue = await prisma.billingSubscription.count({
        where: { state: "past_due" },
      });
      const expectedExpired = await prisma.billingSubscription.count({
        where: { state: "expired" },
      });
      const expectedUnverifiedActive = await prisma.user.count({
        where: { isEmailVerified: false, status: "active" },
      });
      const expectedUnverifiedAnyStatus = await prisma.user.count({
        where: { isEmailVerified: false },
      });

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/revenue/summary")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.pastDueSubscriptions).toBe(expectedPastDue);
      expect(res.body.expiredSubscriptions).toBe(expectedExpired);
      expect(res.body.unverifiedUsers).toBe(expectedUnverifiedActive);
      // The seeded suspended unverified user must NOT be counted, so the
      // active-only count is strictly below the all-statuses count.
      expect(res.body.unverifiedUsers).toBeLessThan(
        expectedUnverifiedAnyStatus,
      );
    });

    it("filters subscriptions by state", async () => {
      await seedAttentionData();

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/subscriptions?state=past_due")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.state).toBe("past_due");
      }
    });

    it("filters users by verification state", async () => {
      const { unverified } = await seedAttentionData();

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/users?verified=false")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(
        res.body.items.some(
          (u: { email: string }) => u.email === unverified.email,
        ),
      ).toBe(true);
      for (const item of res.body.items) {
        expect(item.isEmailVerified).toBe(false);
      }
    });
  });
});
