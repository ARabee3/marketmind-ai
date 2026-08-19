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
import { MarketingKnowledgeModule } from "../src/modules/marketing-knowledge/marketing-knowledge.module";
import { KnowledgeLibraryAdminService } from "../src/modules/marketing-knowledge/admin/knowledge-library-admin.service";

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

describe("Knowledge Library Admin (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let adminToken: string;
  let devDemoToken: string;
  let triggerSpy: jest.SpyInstance;

  const SLUG = `admin-e2e/${Date.now()}`;
  const DRAFT_SLUG = `${SLUG}/draft`;
  const APPROVED_SLUG = `${SLUG}/approved`;
  let draftEntryId = "";
  let approvedEntryId = "";

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
        MarketingKnowledgeModule,
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
    triggerSpy = jest.spyOn(
      app.get(KnowledgeLibraryAdminService),
      "triggerIngestion",
    );

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

    await seedKnowledge();
  });

  afterAll(async () => {
    await cleanupSeedData();
    await app.close();
  });

  async function seedKnowledge() {
    await cleanupSeedData();

    const draftEntry = await prisma.marketingKnowledgeEntry.create({
      data: { slug: DRAFT_SLUG },
    });
    draftEntryId = draftEntry.id;
    const draftVersion = await prisma.marketingKnowledgeEntryVersion.create({
      data: {
        entryId: draftEntry.id,
        version: 1,
        kind: "framework",
        title: "Admin e2e draft",
        summary: "Draft awaiting review",
        body: "Draft body — will be approved or rejected by an admin.",
        locale: "en",
        markets: ["egypt"],
        industries: ["retail"],
        businessModels: [],
        objectives: ["awareness"],
        funnelStages: ["awareness"],
        channels: ["facebook"],
        seasons: [],
        budgetModes: ["organic_only"],
        evidenceTier: "contextual_note",
        reviewStatus: "draft",
        effectiveAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        author: "e2e-author",
        checksum: `chk-draft-${Date.now()}`,
      },
    });
    await prisma.marketingKnowledgeEntry.update({
      where: { id: draftEntry.id },
      data: { latestVersion: 1 },
    });

    const approvedEntry = await prisma.marketingKnowledgeEntry.create({
      data: { slug: APPROVED_SLUG },
    });
    approvedEntryId = approvedEntry.id;
    await prisma.marketingKnowledgeEntryVersion.create({
      data: {
        entryId: approvedEntry.id,
        version: 1,
        kind: "benchmark_report",
        title: "Admin e2e approved",
        summary: "Already approved",
        body: "Approved body.",
        locale: "en",
        markets: ["egypt"],
        industries: ["retail"],
        businessModels: [],
        objectives: ["conversion"],
        funnelStages: ["conversion"],
        channels: ["facebook"],
        seasons: [],
        budgetModes: ["monthly_amount"],
        evidenceTier: "verified_benchmark",
        reviewStatus: "approved",
        effectiveAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        author: "e2e-author",
        reviewer: "reviewer@e2e.test",
        reviewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        checksum: `chk-approved-${Date.now()}`,
      },
    });
    await prisma.marketingKnowledgeEntry.update({
      where: { id: approvedEntry.id },
      data: { latestVersion: 1 },
    });
  }

  async function cleanupSeedData() {
    if (draftEntryId) {
      await prisma.marketingKnowledgeEntryVersion.deleteMany({
        where: { entryId: draftEntryId },
      });
      await prisma.marketingKnowledgeEntry.deleteMany({
        where: { id: draftEntryId },
      });
      draftEntryId = "";
    }
    if (approvedEntryId) {
      await prisma.marketingKnowledgeEntryVersion.deleteMany({
        where: { entryId: approvedEntryId },
      });
      await prisma.marketingKnowledgeEntry.deleteMany({
        where: { id: approvedEntryId },
      });
      approvedEntryId = "";
    }
    await prisma.marketingKnowledgeIngestionRun.deleteMany({
      where: { actor: "admin@e2e.test" },
    });
  }

  describe("GET /admin/library/entries authorization", () => {
    it("rejects anonymous access with 401", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/library/entries")
        .expect(401);
    });

    it("rejects OWNER access with 403", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/library/entries")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("rejects DEVELOPER_DEMO access with 403", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/library/entries")
        .set("Authorization", `Bearer ${devDemoToken}`)
        .expect(403);
    });

    it("allows ADMIN to list entries", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/library/entries")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("page");
      expect(res.body).toHaveProperty("pageSize");
      expect(Array.isArray(res.body.items)).toBe(true);
      const slugs = res.body.items.map((i: { entry: { slug: string } }) => i.entry.slug);
      expect(slugs).toContain(DRAFT_SLUG);
      expect(slugs).toContain(APPROVED_SLUG);
    });

    it("filters by latest version status", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/library/entries?status=draft")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.latest?.reviewStatus).toBe("draft");
      }
    });

    it("rejects an invalid status filter with 400", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/library/entries?status=maybe")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(400);
    });

    it("searches entries by title", async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/admin/library/entries?search=${encodeURIComponent("draft awaiting")}`,
        )
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      const slugs = res.body.items.map((i: { entry: { slug: string } }) => i.entry.slug);
      expect(slugs).toContain(DRAFT_SLUG);
    });
  });

  describe("GET /admin/library/entries/:slug", () => {
    it("returns entry detail with versions for admin", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/library/entries/${DRAFT_SLUG}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.entry).toHaveProperty("slug", DRAFT_SLUG);
      expect(Array.isArray(res.body.versions)).toBe(true);
      expect(res.body.versions).toHaveLength(1);
      expect(res.body.versions[0]).toHaveProperty("reviewStatus", "draft");
    });

    it("returns 404 for a missing entry", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/admin/library/entries/does-not-exist")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe("POST /admin/library/entries/:slug/approve", () => {
    it("rejects anonymous approve with 401", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${DRAFT_SLUG}/approve`)
        .expect(401);
    });

    it("rejects OWNER approve with 403", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${DRAFT_SLUG}/approve`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("approves the current draft and records the reviewer", async () => {
      await seedKnowledge();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${DRAFT_SLUG}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body).toHaveProperty("reviewStatus", "approved");
      expect(res.body).toHaveProperty("version");

      const latest = await prisma.marketingKnowledgeEntryVersion.findFirst({
        where: { entryId: draftEntryId },
        orderBy: { version: "desc" },
      });
      expect(latest?.reviewStatus).toBe("approved");
      expect(latest?.reviewer).toBe("admin@e2e.test");
      expect(latest?.reviewedAt).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { action: "knowledge.approve", targetId: draftEntryId },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeTruthy();
      expect(audit?.actorEmail).toBe("admin@e2e.test");
    });

    it("rejects approving an already-approved entry with 409", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${APPROVED_SLUG}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(409);
    });

    it("returns 404 for a missing entry", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/library/entries/does-not-exist/approve")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe("POST /admin/library/entries/:slug/reject", () => {
    it("rejects anonymous reject with 401", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${DRAFT_SLUG}/reject`)
        .expect(401);
    });

    it("rejects OWNER reject with 403", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${DRAFT_SLUG}/reject`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("rejects the current draft by retiring it", async () => {
      await seedKnowledge();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${DRAFT_SLUG}/reject`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body).toHaveProperty("reviewStatus", "retired");

      const latest = await prisma.marketingKnowledgeEntryVersion.findFirst({
        where: { entryId: draftEntryId },
        orderBy: { version: "desc" },
      });
      expect(latest?.reviewStatus).toBe("retired");

      const audit = await prisma.auditLog.findFirst({
        where: { action: "knowledge.reject", targetId: draftEntryId },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeTruthy();
    });

    it("rejects rejecting an approved entry with 409", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/library/entries/${APPROVED_SLUG}/reject`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(409);
    });
  });

  describe("POST /admin/library/ingest", () => {
    it("rejects anonymous ingest with 401", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/library/ingest")
        .expect(401);
    });

    it("rejects OWNER ingest with 403", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/admin/library/ingest")
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(403);
    });

    it("records an ingestion run for the admin actor", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/library/ingest")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("actor", "admin@e2e.test");
      expect(res.body).toHaveProperty("status", "running");
      expect(triggerSpy).toHaveBeenCalled();
    });

    it("lists ingestion runs", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/library/ingestion-runs")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("items");
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });
});