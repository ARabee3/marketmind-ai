import {
  BadRequestException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";

import { configuration } from "../src/config/configuration";
import { envSchema } from "../src/config/env.schema";
import { AuthModule } from "../src/modules/auth/auth.module";
import { RbacModule } from "../src/modules/rbac/rbac.module";
import { RedisService } from "../src/modules/redis/redis.service";
import { ContentService } from "../src/modules/content/content.service";
import { ContentRateLimitGuard } from "../src/modules/content/content-rate-limit.guard";
import {
  ContentCycleController,
  ContentPackController,
  ContentAssetController,
  PublicationCandidateController,
} from "../src/modules/content/content.controller";
import {
  computePublicationCandidateChecksum,
  isPublicationCandidateChecksumValid,
} from "@marketmind/contracts";
import type { PublicationCandidateV1 } from "@marketmind/contracts";

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const PACK_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";
const CANDIDATE_ID = "44444444-4444-4444-8444-444444444444";
const BUSINESS_ID = "55555555-5555-4555-8555-555555555555";
const STRATEGY_ID = "66666666-6666-4666-8666-666666666666";
const STRATEGY_DECISION_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID = "99999999-9999-4999-8999-999999999999";
const ITEM_VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DECISION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEST_ACCESS_SECRET = "content-e2e-access-secret";

process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "content-e2e-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_CALLBACK_URL =
  "http://localhost:3001/api/v1/auth/google/callback";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://marketmind:marketmind_dev@localhost:5432/marketmind_dev?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function mockRedisClient() {
  return {
    pipeline: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 1],
        [null, 1],
      ]),
    }),
  };
}

describe("Content public contract (e2e)", () => {
  let app: INestApplication;
  let ownerToken: string;

  const contentService = {
    createCycle: jest.fn(),
    upsertWeekContext: jest.fn(),
    safeDefaultWeekContext: jest.fn(),
    generateWeek: jest.fn(),
    pauseCycle: jest.fn(),
    resumeCycle: jest.fn(),
    getCycle: jest.fn(),
    listWeeks: jest.fn(),
    getPack: jest.fn(),
    getPackProgress: jest.fn(),
    getItemVersions: jest.fn(),
    getAsset: jest.fn(),
    getPublicationCandidate: jest.fn(),
    getPackRetryEligibility: jest.fn(),
    retryPack: jest.fn(),
    decide: jest.fn(),
    requestRevision: jest.fn(),
    bulkDecide: jest.fn(),
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
      ],
      controllers: [
        ContentCycleController,
        ContentPackController,
        ContentAssetController,
        PublicationCandidateController,
      ],
      providers: [
        ContentRateLimitGuard,
        {
          provide: RedisService,
          useValue: { getClient: jest.fn().mockReturnValue(mockRedisClient()) },
        },
        { provide: ContentService, useValue: contentService },
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

    const jwtService = app.get(JwtService);
    ownerToken = await jwtService.signAsync(
      {
        sub: "owner-user-id",
        email: "owner@e2e.test",
        roles: [Role.OWNER],
      },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  // ── Authentication ───────────────────────────────────────────────────

  it("rejects unauthenticated access to content cycles", () =>
    request(app.getHttpServer())
      .get(`/api/v1/content-cycles/${CYCLE_ID}`)
      .expect(401));

  it("rejects unauthenticated content pack access", () =>
    request(app.getHttpServer())
      .get(`/api/v1/content-packs/${PACK_ID}`)
      .expect(401));

  it("rejects unauthenticated content asset access", () =>
    request(app.getHttpServer())
      .get(`/api/v1/content-assets/${ASSET_ID}`)
      .expect(401));

  it("rejects unauthenticated publication candidate access", () =>
    request(app.getHttpServer())
      .get(`/api/v1/publication-candidates/${CANDIDATE_ID}`)
      .expect(401));

  // ── Cycle creation ───────────────────────────────────────────────────

  it("accepts a valid cycle creation request", () => {
    contentService.createCycle.mockResolvedValue({ id: CYCLE_ID });

    return request(app.getHttpServer())
      .post("/api/v1/content-cycles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        business_id: BUSINESS_ID,
        strategy_id: STRATEGY_ID,
        strategy_version: 1,
        strategy_decision_id: STRATEGY_DECISION_ID,
        idempotency_key: "idem-1",
        initial_week_context: {
          week_number: 1,
          week_start_date: "2026-08-03",
          promotion_mode: "none",
          promotion: null,
          must_include: [],
          must_avoid: [],
          approved_asset_ids: [],
          cta_destination: { type: "none", value: null },
        },
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.id).toBe(CYCLE_ID);
        expect(contentService.createCycle).toHaveBeenCalledWith(
          expect.objectContaining({
            business_id: BUSINESS_ID,
            strategy_id: STRATEGY_ID,
          }),
          "owner-user-id",
        );
      });
  });

  // ── DTO validation ───────────────────────────────────────────────────

  it("rejects cycle creation with missing required fields (400)", () =>
    request(app.getHttpServer())
      .post("/api/v1/content-cycles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(400)
      .expect(() =>
        expect(contentService.createCycle).not.toHaveBeenCalled(),
      ));

  // ── Param validation ─────────────────────────────────────────────────

  it("validates cycle id format before calling the service (400)", () =>
    request(app.getHttpServer())
      .get("/api/v1/content-cycles/not-a-uuid")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(400)
      .expect(() =>
        expect(contentService.getCycle).not.toHaveBeenCalled(),
      ));

  // ── Service error propagation ────────────────────────────────────────

  it("returns 404 when the cycle does not exist", () => {
    contentService.getCycle.mockRejectedValue(new NotFoundException());

    return request(app.getHttpServer())
      .get(`/api/v1/content-cycles/${CYCLE_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(404);
  });

  it("returns 400 when generation is already in progress", () => {
    contentService.generateWeek.mockRejectedValue(
      new BadRequestException("Generation is already in progress"),
    );

    return request(app.getHttpServer())
      .post(`/api/v1/content-cycles/${CYCLE_ID}/weeks/1/generate`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(400);
  });

  // ── Lifecycle: cycle → generate → decide → candidate ────────────────

  it("create cycle + generate week + get pack + approve decision + validate candidate checksum", async () => {
    const cycleResponse = {
      content_cycle: {
        id: CYCLE_ID,
        contract_version: "content-v1",
        business_id: BUSINESS_ID,
        strategy_id: STRATEGY_ID,
        strategy_version: 1,
        strategy_decision_id: STRATEGY_DECISION_ID,
        profile_version_id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
        status: "active",
        current_week_number: 1,
        timezone: "Africa/Cairo",
        pause_reason: null,
        completed_at: null,
        created_at: "2026-08-03T00:00:00.000Z",
      },
      initial_week_context: {
        id: "wwwwwwww-wwww-4www-8www-wwwwwwwwwwww",
        content_cycle_id: CYCLE_ID,
        week_number: 1,
        week_start_date: "2026-08-03",
        promotion_mode: "none",
        must_include: [],
        must_avoid: [],
        approved_asset_ids: [],
        cta_destination: { type: "none", value: null },
      },
    };

    const pack3Items = {
      id: PACK_ID,
      contract_version: "content-v1",
      content_cycle_id: CYCLE_ID,
      week_number: 1,
      business_id: BUSINESS_ID,
      strategy_id: STRATEGY_ID,
      status: "draft",
      retry_eligible: true,
      items: [
        {
          id: ITEM_ID,
          content_pack_id: PACK_ID,
          current_version_id: ITEM_VERSION_ID,
          status: "draft",
        },
      ],
      progress: [],
    };

    const base = {
      contract_version: "publication-candidate-v1" as const,
      candidate_id: CANDIDATE_ID,
      business_id: BUSINESS_ID,
      strategy_id: STRATEGY_ID,
      strategy_version: 1,
      content_cycle_id: CYCLE_ID,
      strategy_week_number: 1,
      content_pack_id: PACK_ID,
      content_item_id: ITEM_ID,
      content_item_version_id: ITEM_VERSION_ID,
      content_item_version: 1,
      content_item_version_checksum: "verification-checksum",
      target_channel: "instagram" as const,
      content_format: "text_post" as const,
      selected_locale: "ar" as const,
      caption: "Test caption",
      cta: null,
      hashtags: [] as string[],
      alt_text: "test alt text",
      assets: [] as [],
      recommended_publish_window: {
        starts_at: "2026-08-03T00:00:00.000Z",
        ends_at: "2026-08-10T00:00:00.000Z",
        timezone: "Africa/Cairo" as const,
      },
      approval: {
        decision_id: DECISION_ID,
        decision: "approved" as const,
        content_item_version_id: ITEM_VERSION_ID,
        content_item_version_checksum: "verification-checksum",
        decided_by_user_id: "owner-user-id",
        decided_at: "2026-08-03T10:00:00.000Z",
      },
      created_at: "2026-08-03T10:00:00.000Z",
    };
    const checksum = computePublicationCandidateChecksum(
      base as unknown as PublicationCandidateV1,
    );
    const candidate: PublicationCandidateV1 = {
      ...base,
      candidate_checksum: checksum,
    };

    const decideResponse = {
      decision: {
        id: DECISION_ID,
        content_item_id: ITEM_ID,
        content_item_version_id: ITEM_VERSION_ID,
        content_item_version: 1,
        content_item_version_checksum: "verification-checksum",
        decision: "approved",
        revision_notes: null,
        decided_by_user_id: "owner-user-id",
        decided_at: "2026-08-03T10:00:00.000Z",
      },
      publication_candidate: candidate,
    };

    // Step 1: Create cycle
    contentService.createCycle.mockResolvedValue(cycleResponse);

    await request(app.getHttpServer())
      .post("/api/v1/content-cycles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        business_id: BUSINESS_ID,
        strategy_id: STRATEGY_ID,
        strategy_version: 1,
        strategy_decision_id: STRATEGY_DECISION_ID,
        idempotency_key: "lifecycle-idem-1",
        initial_week_context: {
          week_number: 1,
          week_start_date: "2026-08-03",
          promotion_mode: "none",
          promotion: null,
          must_include: [],
          must_avoid: [],
          approved_asset_ids: [],
          cta_destination: { type: "none", value: null },
        },
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.content_cycle.id).toBe(CYCLE_ID);
        expect(res.body.initial_week_context).toBeDefined();
      });

    // Step 2: Generate week 1
    contentService.generateWeek.mockResolvedValue({ pack: pack3Items });

    await request(app.getHttpServer())
      .post(`/api/v1/content-cycles/${CYCLE_ID}/weeks/1/generate`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        content_cycle_id: CYCLE_ID,
        week_number: 1,
        idempotency_key: "lifecycle-gen-1",
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.pack.id).toBe(PACK_ID);
      });

    // Step 3: Get pack with items
    contentService.getPack.mockResolvedValue(pack3Items);

    await request(app.getHttpServer())
      .get(`/api/v1/content-packs/${PACK_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe("draft");
        expect(res.body.items).toHaveLength(1);
      });

    // Step 4: Approve decision → candidate
    contentService.decide.mockResolvedValue(decideResponse);

    await request(app.getHttpServer())
      .post(`/api/v1/content-packs/${PACK_ID}/items/${ITEM_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        content_item_id: ITEM_ID,
        decision: "approved",
        content_item_version_id: ITEM_VERSION_ID,
        content_item_version_checksum: "verification-checksum",
        idempotency_key: "lifecycle-decision-1",
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.publication_candidate).not.toBeNull();
        expect(res.body.decision.decision).toBe("approved");
      });

    // Step 5: Validate candidate checksum
    contentService.getPublicationCandidate.mockResolvedValue({
      candidate,
      status: { candidate_state: "active", state_version: 1 },
    });

    const candidateRes = await request(app.getHttpServer())
      .get(`/api/v1/publication-candidates/${CANDIDATE_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const fetched = candidateRes.body.candidate;
    expect(isPublicationCandidateChecksumValid(fetched)).toBe(true);
  });
});
