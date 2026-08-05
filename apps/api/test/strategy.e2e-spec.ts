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
import { StrategyController } from "../src/modules/strategy/strategy.controller";
import { StrategyService } from "../src/modules/strategy/strategy.service";
import { StrategyRateLimitGuard } from "../src/modules/strategy/strategy-rate-limit.guard";

const STRATEGY_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const TEST_ACCESS_SECRET = "strategy-e2e-access-secret";

process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "strategy-e2e-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:3001/api/v1/auth/google/callback";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://marketmind:marketmind_dev@localhost:5432/marketmind_dev?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function mockRedisClient() {
  return {
    pipeline: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
    }),
  };
}

describe("Strategy public contract (e2e)", () => {
  let app: INestApplication;
  let ownerToken: string;
  let developerToken: string;

  const strategyService = {
    createStrategy: jest.fn(),
    upsertBrief: jest.fn(),
    startGeneration: jest.fn(),
    getStrategy: jest.fn(),
    getStrategyVersion: jest.fn(),
    getStrategyVersions: jest.fn(),
    getProgressEvents: jest.fn(),
    getRetrievalPack: jest.fn(),
    handleDecision: jest.fn(),
    retryGeneration: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: envSchema }),
        AuthModule,
        RbacModule,
      ],
      controllers: [StrategyController],
      providers: [
        StrategyRateLimitGuard,
        {
          provide: RedisService,
          useValue: { getClient: jest.fn().mockReturnValue(mockRedisClient()) },
        },
        { provide: StrategyService, useValue: strategyService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const jwtService = app.get(JwtService);
    ownerToken = await jwtService.signAsync(
      { sub: "owner-user-id", email: "owner@e2e.test", roles: [Role.OWNER] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
    developerToken = await jwtService.signAsync(
      { sub: "dev-user-id", email: "dev@e2e.test", roles: [Role.DEVELOPER_DEMO] },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  // ── Authentication ──────────────────────────────────────────────────

  it("rejects unauthenticated strategy creation", () =>
    request(app.getHttpServer()).post("/api/v1/strategies").expect(401));

  it("rejects unauthenticated generate requests", () =>
    request(app.getHttpServer())
      .post(`/api/v1/strategies/${STRATEGY_ID}/generate`)
      .expect(401));

  // ── RBAC: developer_demo lacks strategy:start ───────────────────────

  it("rejects strategy creation by a developer_demo user (403)", () =>
    request(app.getHttpServer())
      .post("/api/v1/strategies")
      .set("Authorization", `Bearer ${developerToken}`)
      .send({ businessProfileVersionId: PROFILE_VERSION_ID })
      .expect(403));

  // ── Routing: no double /api/v1 prefix ───────────────────────────────

  it("routes POST /api/v1/strategies without double-prefixing", () => {
    strategyService.createStrategy.mockResolvedValue({ id: STRATEGY_ID });

    return request(app.getHttpServer())
      .post("/api/v1/strategies")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ businessProfileVersionId: PROFILE_VERSION_ID })
      .expect(201)
      .expect((response) => {
        expect(response.body.id).toBe(STRATEGY_ID);
        expect(strategyService.createStrategy).toHaveBeenCalledWith(
          { businessProfileVersionId: PROFILE_VERSION_ID },
          "owner-user-id",
        );
      });
  });

  // ── DTO validation ──────────────────────────────────────────────────

  it("rejects a strategy creation with an invalid businessProfileVersionId (400)", () =>
    request(app.getHttpServer())
      .post("/api/v1/strategies")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ businessProfileVersionId: "not-a-uuid" })
      .expect(400));

  it("rejects a brief update with missing required fields (400)", () =>
    request(app.getHttpServer())
      .put(`/api/v1/strategies/${STRATEGY_ID}/brief`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ businessProfileVersionId: PROFILE_VERSION_ID })
      .expect(400)
      .expect(() => expect(strategyService.upsertBrief).not.toHaveBeenCalled()));

  it("accepts a valid brief with externalBudgetEgpAmount", () => {
    strategyService.upsertBrief.mockResolvedValue({
      id: "brief-1",
      strategyId: STRATEGY_ID,
      businessProfileVersionId: PROFILE_VERSION_ID,
      primaryObjective: "awareness",
    });

    return request(app.getHttpServer())
      .put(`/api/v1/strategies/${STRATEGY_ID}/brief`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        businessProfileVersionId: PROFILE_VERSION_ID,
        primaryObjective: "awareness",
        startDate: "2026-08-01",
        planLanguage: "ar-EG",
        paidMediaAllowed: true,
        externalBudgetMode: "monthly_amount",
        externalBudgetEgpAmount: 5000,
        teamCapacity: "2 hours/day",
      })
      .expect(200);
  });

  // ── Param validation ────────────────────────────────────────────────

  it("validates strategy id format before calling the service (400)", () =>
    request(app.getHttpServer())
      .get("/api/v1/strategies/not-a-uuid")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(400)
      .expect(() => expect(strategyService.getStrategy).not.toHaveBeenCalled()));

  it("validates version param is an integer", () =>
    request(app.getHttpServer())
      .get(`/api/v1/strategies/${STRATEGY_ID}/versions/not-a-number`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(400));

  // ── Ownership: 404 for non-owners ───────────────────────────────────

  it("returns 404 when the strategy does not belong to the owner", () => {
    strategyService.getStrategy.mockRejectedValue(new NotFoundException());

    return request(app.getHttpServer())
      .get(`/api/v1/strategies/${STRATEGY_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(404);
  });

  // ── Idempotency: 400 when already generating ────────────────────────

  it("returns 400 when generation is already in progress", () => {
    strategyService.startGeneration.mockRejectedValue(
      new BadRequestException("Generation is already in progress"),
    );

    return request(app.getHttpServer())
      .post(`/api/v1/strategies/${STRATEGY_ID}/generate`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(400);
  });

  // ── Decisions ───────────────────────────────────────────────────────

  it("accepts a valid approve decision", () => {
    strategyService.handleDecision.mockResolvedValue({
      decision: { id: "dec-1" },
      nextStatus: "approved",
    });

    return request(app.getHttpServer())
      .post(`/api/v1/strategies/${STRATEGY_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ versionId: VERSION_ID, action: "approve" })
      .expect(201)
      .expect((response) => {
        expect(response.body.nextStatus).toBe("approved");
        expect(strategyService.handleDecision).toHaveBeenCalledWith(
          STRATEGY_ID,
          "owner-user-id",
          { versionId: VERSION_ID, action: "approve" },
        );
      });
  });

  it("rejects a decision with an invalid action (400)", () =>
    request(app.getHttpServer())
      .post(`/api/v1/strategies/${STRATEGY_ID}/decisions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ versionId: VERSION_ID, action: "invalid_action" })
      .expect(400));

  // ── Retry ───────────────────────────────────────────────────────────

  it("returns 400 when retry limit is exceeded", () => {
    strategyService.retryGeneration.mockRejectedValue(
      new BadRequestException("Maximum retry limit of 3 has been reached"),
    );

    return request(app.getHttpServer())
      .post(`/api/v1/strategies/${STRATEGY_ID}/retry`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(400);
  });
});
