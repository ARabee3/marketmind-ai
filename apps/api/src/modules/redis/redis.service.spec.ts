import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "./redis.service";

describe("RedisService", () => {
  let service: RedisService;
  let config: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue("redis://localhost:6379"),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    config = module.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("ping", () => {
    it("should return false when redis is not connected", async () => {
      // Simulate disconnected state by destroying the client
      await service.onModuleDestroy();
      const result = await service.ping();
      expect(result).toBe(false);
    });
  });

  describe("getClient", () => {
    it("should throw when redis is not connected", () => {
      service.onModuleDestroy();
      expect(() => service.getClient()).toThrow("Redis client is not connected");
    });
  });
});
