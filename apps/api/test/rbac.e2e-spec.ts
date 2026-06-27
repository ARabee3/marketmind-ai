import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";

import { configuration } from "../src/config/configuration";
import { envSchema } from "../src/config/env.schema";
import { AuthModule } from "../src/modules/auth/auth.module";
import { JwtAuthGuard } from "../src/modules/auth/guards/jwt-auth.guard";
import { RbacModule } from "../src/modules/rbac/rbac.module";
import { Permissions } from "../src/modules/rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../src/modules/rbac/guards/permissions.guard";
import { PERMISSIONS } from "../src/modules/rbac/rbac.constants";

// ---------------------------------------------------------------------------
// Test-only controller exercising the guard/decorator pattern across several
// permissions. Lives only in this spec so the production controller stays
// lean while the e2e can assert allow/deny for each permission.
// ---------------------------------------------------------------------------
@Controller("rbac-test")
@UseGuards(JwtAuthGuard, PermissionsGuard)
class RbacTestController {
  @Get("business-read")
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSIONS.BUSINESS_READ)
  businessRead() {
    return { status: "allowed", permission: PERMISSIONS.BUSINESS_READ };
  }

  @Get("admin-library")
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSIONS.ADMIN_MANAGE_LIBRARY)
  adminLibrary() {
    return { status: "allowed", permission: PERMISSIONS.ADMIN_MANAGE_LIBRARY };
  }

  @Get("confirm-profile")
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSIONS.DISCOVERY_CONFIRM_PROFILE)
  confirmProfile() {
    return {
      status: "allowed",
      permission: PERMISSIONS.DISCOVERY_CONFIRM_PROFILE,
    };
  }
}

// JWT secrets must be set before the testing module is compiled because
// JwtStrategy reads JWT_ACCESS_SECRET via ConfigService at construction.
const TEST_ACCESS_SECRET = "test-access-secret";
process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";

describe("RBAC (e2e)", () => {
  let app: INestApplication;
  let jwtService: JwtService;

  // Tokens minted once jwtService is available in beforeAll.
  let ownerToken: string;
  let adminToken: string;
  let devDemoToken: string;

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
      ],
      controllers: [RbacTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    jwtService = app.get(JwtService);
    ownerToken = await jwtService.signAsync(
      { sub: "owner-user-id", email: "owner@e2e.test", roles: [Role.OWNER] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    adminToken = await jwtService.signAsync(
      { sub: "admin-user-id", email: "admin@e2e.test", roles: [Role.ADMIN] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    devDemoToken = await jwtService.signAsync(
      {
        sub: "dev-user-id",
        email: "dev@e2e.test",
        roles: [Role.DEVELOPER_DEMO],
      },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // GET /api/v1/rbac/me/permissions — current-user permission lookup
  // =========================================================================

  describe("GET /api/v1/rbac/me/permissions", () => {
    it("should reject unauthenticated access with 401", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac/me/permissions")
        .expect(401));

    it("should return the owner's roles and 6 permissions (no admin:manage_library)", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac/me/permissions")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.roles).toEqual(["OWNER"]);
          expect(res.body.permissions).toEqual(
            [
              "business:read",
              "business:update",
              "discovery:confirm_profile",
              "discovery:continue",
              "discovery:start",
              "strategy:start",
            ].sort(),
          );
          expect(res.body.permissions).not.toContain("admin:manage_library");
        }));

    it("should return all 7 permissions for admin", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac/me/permissions")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.roles).toEqual(["ADMIN"]);
          expect(res.body.permissions).toHaveLength(7);
          expect(res.body.permissions).toContain("admin:manage_library");
        }));

    it("should return the 3 limited developer_demo permissions", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac/me/permissions")
        .set("Authorization", `Bearer ${devDemoToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.roles).toEqual(["DEVELOPER_DEMO"]);
          expect(res.body.permissions).toEqual(
            ["business:read", "discovery:continue", "discovery:start"].sort(),
          );
        }));
  });

  // =========================================================================
  // Permission-guarded routes — allow/deny decisions
  // =========================================================================

  describe("permission guard allow/deny", () => {
    it("should reject unauthenticated access to a protected route with 401", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/business-read")
        .expect(401));

    it("should allow owner access to business:read", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/business-read")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe("allowed");
          expect(res.body.permission).toBe("business:read");
        }));

    it("should allow developer_demo access to business:read", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/business-read")
        .set("Authorization", `Bearer ${devDemoToken}`)
        .expect(200));

    it("should allow owner access to discovery:confirm_profile", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/confirm-profile")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200));

    it("should reject developer_demo access to discovery:confirm_profile with 403", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/confirm-profile")
        .set("Authorization", `Bearer ${devDemoToken}`)
        .expect(403));

    it("should reject owner access to admin:manage_library with 403", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/admin-library")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403));

    it("should allow admin access to admin:manage_library", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/admin-library")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.permission).toBe("admin:manage_library");
        }));

    it("should reject developer_demo access to admin:manage_library with 403", () =>
      request(app.getHttpServer())
        .get("/api/v1/rbac-test/admin-library")
        .set("Authorization", `Bearer ${devDemoToken}`)
        .expect(403));
  });
});
