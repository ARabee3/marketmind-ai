import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../common/persistence/prisma.service";
import { RedisService } from "../redis/redis.service";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            ping: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<RedisService>(RedisService);
  });

  describe("check", () => {
    it("should return healthy when all dependencies are up", async () => {
      jest.spyOn(prisma, "$queryRaw").mockResolvedValue([{ "?column?": 1 }]);
      jest.spyOn(redis, "ping").mockResolvedValue(true);

      const result = await controller.check();

      expect(result.status).toBe("healthy");
      expect(result.checks.database.status).toBe("up");
      expect(result.checks.redis.status).toBe("up");
      expect(result.checks.queue.status).toBe("up");
    });

    it("should return unhealthy when database is down", async () => {
      jest.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("Connection refused"));
      jest.spyOn(redis, "ping").mockResolvedValue(true);

      const result = await controller.check();

      expect(result.status).toBe("unhealthy");
      expect(result.checks.database.status).toBe("down");
      expect(result.checks.redis.status).toBe("up");
    });

    it("should return unhealthy when redis is down", async () => {
      jest.spyOn(prisma, "$queryRaw").mockResolvedValue([{ "?column?": 1 }]);
      jest.spyOn(redis, "ping").mockResolvedValue(false);

      const result = await controller.check();

      expect(result.status).toBe("unhealthy");
      expect(result.checks.database.status).toBe("up");
      expect(result.checks.redis.status).toBe("down");
      expect(result.checks.queue.status).toBe("down");
    });
  });
});
