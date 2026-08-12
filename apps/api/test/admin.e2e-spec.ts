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
  let ownerToken: string;
  let adminToken: string;
  let devDemoToken: string;

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

  afterAll(async () => app.close());

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
      expect(typeof res.body.activeBusinesses).toBe("number");
      expect(typeof res.body.activeSubscriptions).toBe("number");
      expect(typeof res.body.trialingCount).toBe("number");
      expect(typeof res.body.mrrEgp).toBe("number");
      // typeof Infinity === "number"; only Number.isFinite rejects it after JSON round-trip (null).
      expect(Number.isFinite(res.body.mrrEgp)).toBe(true);
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
  });
});
