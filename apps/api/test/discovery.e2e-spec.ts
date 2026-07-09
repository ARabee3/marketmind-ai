import {
  ConflictException,
  INestApplication,
  ServiceUnavailableException,
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
import { DiscoveryConversationService } from "../src/modules/discovery/discovery-conversation.service";
import { DiscoveryController } from "../src/modules/discovery/discovery.controller";
import { DiscoveryRateLimitGuard } from "../src/modules/discovery/discovery-rate-limit.guard";
import { DiscoveryRedisLimiterService } from "../src/modules/discovery/discovery-redis-limiter.service";
import { DiscoveryService } from "../src/modules/discovery/discovery.service";
import { RedisService } from "../src/modules/redis/redis.service";
import { RbacModule } from "../src/modules/rbac/rbac.module";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const TEST_ACCESS_SECRET = "discovery-e2e-access-secret";

process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "discovery-e2e-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";

describe("Discovery public contract (e2e)", () => {
  let app: INestApplication;
  let ownerToken: string;

  const discoveryService = {
    startPreparedDiscovery: jest.fn(),
    getStatus: jest.fn(),
  };
  const conversationService = {
    respondToDiscovery: jest.fn(),
    summarizeDiscovery: jest.fn(),
    confirmProfile: jest.fn(),
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
      controllers: [DiscoveryController],
      providers: [
        DiscoveryRateLimitGuard,
        DiscoveryRedisLimiterService,
        {
          provide: RedisService,
          useValue: {
            ping: jest.fn(),
            getClient: jest.fn().mockReturnValue({
              pipeline: jest.fn().mockReturnValue({
                incr: jest.fn().mockReturnThis(),
                expire: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
              }),
            }),
          },
        },
        { provide: DiscoveryService, useValue: discoveryService },
        {
          provide: DiscoveryConversationService,
          useValue: conversationService,
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

    ownerToken = await app.get(JwtService).signAsync(
      {
        sub: "owner-user-id",
        email: "owner@e2e.test",
        roles: [Role.OWNER],
      },
      { secret: TEST_ACCESS_SECRET, expiresIn: "15m" },
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated discovery starts", () =>
    request(app.getHttpServer()).post("/api/v1/discovery/start").expect(401));

  it("accepts a valid intake and exposes the real Socket.IO namespace", () => {
    discoveryService.startPreparedDiscovery.mockResolvedValue({
      session_id: SESSION_ID,
      status: "researching",
      progress_ws_url: "/ws/v1/discovery",
      status_url: `/api/v1/discovery/${SESSION_ID}/status`,
      accepted_at: "2026-06-29T10:00:00.000Z",
    });

    return request(app.getHttpServer())
      .post("/api/v1/discovery/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        language_mode: "mixed",
        intake: {
          business_name: "Koshary Corner",
          business_type: "restaurant",
          city: "Cairo",
        },
      })
      .expect(202)
      .expect((response) => {
        expect(response.body.progress_ws_url).toBe("/ws/v1/discovery");
        expect(discoveryService.startPreparedDiscovery).toHaveBeenCalledWith(
          "owner-user-id",
          expect.objectContaining({
            intake: expect.objectContaining({
              business_name: "Koshary Corner",
            }),
          }),
        );
      });
  });

  it("validates session identifiers before calling the service", () =>
    request(app.getHttpServer())
      .get("/api/v1/discovery/not-a-uuid/status")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(400)
      .expect(() => {
        expect(discoveryService.getStatus).not.toHaveBeenCalled();
      }));

  it("returns a conflict for a conversation action in the wrong state", () => {
    conversationService.respondToDiscovery.mockRejectedValue(
      new ConflictException(
        "Discovery session is not in a valid state for this action",
      ),
    );

    return request(app.getHttpServer())
      .post(`/api/v1/discovery/${SESSION_ID}/respond`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ message: "Continue after confirmation." })
      .expect(409);
  });

  it("returns 503 with DISCOVERY_ENQUEUE_FAILED when enqueue fails", () => {
    discoveryService.startPreparedDiscovery.mockRejectedValue(
      new ServiceUnavailableException({
        code: "DISCOVERY_ENQUEUE_FAILED",
        message: "Redis connection refused",
      }),
    );

    return request(app.getHttpServer())
      .post("/api/v1/discovery/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        language_mode: "mixed",
        intake: {
          business_name: "Koshary Corner",
          business_type: "restaurant",
          city: "Cairo",
        },
      })
      .expect(503)
      .expect((response) => {
        expect(response.body.code).toBe("DISCOVERY_ENQUEUE_FAILED");
        expect(response.body.message).toBe("Redis connection refused");
      });
  });
});
