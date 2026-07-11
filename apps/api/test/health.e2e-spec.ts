import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { HealthModule } from "../src/modules/health/health.module";
import { PrismaModule } from "../src/common/persistence/prisma.module";
import { RedisModule } from "../src/modules/redis/redis.module";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { RedisService } from "../src/modules/redis/redis.service";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, RedisModule, HealthModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
      })
      .overrideProvider(RedisService)
      .useValue({
        ping: jest.fn().mockResolvedValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health should return healthy response", () => {
    return request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe("healthy");
        expect(res.body.service).toBe("marketmind-api");
        expect(res.body.timestamp).toBeDefined();
        expect(res.body.checks.database.status).toBe("up");
        expect(res.body.checks.redis.status).toBe("up");
        expect(res.body.checks.queue.status).toBe("up");
      });
  });
});
