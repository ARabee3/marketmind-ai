import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Role, UserStatus } from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";

import { configuration } from "../src/config/configuration";
import { envSchema } from "../src/config/env.schema";
import { AuthModule } from "../src/modules/auth/auth.module";
import { RbacModule } from "../src/modules/rbac/rbac.module";
import { AdminModule } from "../src/modules/admin/admin.module";
import { AuditModule } from "../src/modules/audit/audit.module";
import { AuditService } from "../src/modules/audit/audit.service";
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

describe("Admin Audit (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auditService: AuditService;
  let ownerToken: string;
  let adminToken: string;
  let devDemoToken: string;

  const TEST_EMAIL = "admin-audit-e2e@test.local";
  let actorUserId: string;
  let seededAuditId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: envSchema }),
        AuthModule,
        RbacModule,
        AdminModule,
        AuditModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    prisma = app.get(PrismaService);
    auditService = app.get(AuditService);

    const existing = await prisma.user.findUnique({
      where: { email: TEST_EMAIL },
    });
    if (existing) {
      await prisma.auditLog.deleteMany({
        where: { actorUserId: existing.id },
      });
      await prisma.user.delete({ where: { id: existing.id } });
    }

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

    const actor = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        password: "test-password",
        isEmailVerified: true,
        status: UserStatus.ACTIVE,
      },
    });
    actorUserId = actor.id;

    const audit = await auditService.record({
      actorUserId,
      actorEmail: TEST_EMAIL,
      action: "user.suspend",
      targetType: "user",
      targetId: actorUserId,
      reason: "e2e test audit record",
      beforeState: { status: "active" },
      afterState: { status: "suspended" },
    });
    seededAuditId = audit.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { actorUserId },
    });
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await app.close();
  });

  describe("authorization matrix", () => {
    it("rejects anonymous access to GET /admin/audit with 401", async () => {
      await request(app.getHttpServer()).get("/api/v1/admin/audit").expect(401);
    });

    it("rejects OWNER access to GET /admin/audit with 403", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/audit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("rejects DEVELOPER_DEMO access to GET /admin/audit with 403", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/audit")
        .set("Authorization", `Bearer ${devDemoToken}`)
        .expect(403);
    });
  });

  describe("ADMIN access to the audit trail", () => {
    it("allows ADMIN to list audit logs including the seeded record", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/audit")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("page");
      expect(res.body).toHaveProperty("pageSize");
      expect(res.body.page).toBe(1);
      expect(Array.isArray(res.body.items)).toBe(true);
      const seeded = res.body.items.find(
        (item: { id: string }) => item.id === seededAuditId,
      );
      expect(seeded).toBeDefined();
      expect(seeded.actorUserId).toBe(actorUserId);
      expect(seeded.actorEmail).toBe(TEST_EMAIL);
      expect(seeded.action).toBe("user.suspend");
      expect(seeded.targetType).toBe("user");
      expect(seeded.targetId).toBe(actorUserId);
      expect(seeded.reason).toBe("e2e test audit record");
      expect(seeded.beforeState).toEqual({ status: "active" });
      expect(seeded.afterState).toEqual({ status: "suspended" });
    });

    it("filters audit logs by action", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/audit?action=user.suspend")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      for (const item of res.body.items) {
        expect(item.action).toBe("user.suspend");
      }
    });

    it("filters audit logs by actor user id", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/audit?actor=${actorUserId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      for (const item of res.body.items) {
        expect(item.actorUserId).toBe(actorUserId);
      }
    });

    it("filters audit logs by date range", async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/audit?from=${yesterday}&to=${tomorrow}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBeGreaterThan(0);
      for (const item of res.body.items) {
        const createdAt = new Date(item.createdAt).getTime();
        expect(createdAt).toBeGreaterThanOrEqual(new Date(yesterday).getTime());
        expect(createdAt).toBeLessThanOrEqual(new Date(tomorrow).getTime());
      }
    });

    it("supports pagination", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/audit?page=1&pageSize=5")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(5);
      expect(res.body.items.length).toBeLessThanOrEqual(5);
    });
  });

  describe("immutability of the audit trail", () => {
    it("exposes no update endpoint for audit rows", async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/admin/audit/${seededAuditId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });

    it("exposes no delete endpoint for audit rows", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/audit/${seededAuditId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });

    it("records the exact before/after state through AuditService", async () => {
      const recorded = await prisma.auditLog.findUnique({
        where: { id: seededAuditId },
      });
      expect(recorded).not.toBeNull();
      expect(recorded?.action).toBe("user.suspend");
      expect(recorded?.beforeState).toEqual({ status: "active" });
      expect(recorded?.afterState).toEqual({ status: "suspended" });
    });
  });
});