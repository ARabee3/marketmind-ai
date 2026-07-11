import { HttpException, HttpStatus } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { DiscoveryRedisLimiterService } from "./discovery-redis-limiter.service";

const WINDOW_SECONDS = 60;
const MAX_POSTS = 20;

describe("DiscoveryRedisLimiterService", () => {
  const mockRedisClient = {
    pipeline: jest.fn().mockReturnThis(),
    incr: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  } as unknown as jest.Mocked<RedisService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.getClient.mockReturnValue(mockRedisClient as never);
  });

  function createService(): DiscoveryRedisLimiterService {
    return new DiscoveryRedisLimiterService(mockRedisService);
  }

  it("allows the first 20 requests", async () => {
    mockRedisClient.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
    const service = createService();

    const allowed = await service.checkLimit("owner-1", "/discovery/start");

    expect(allowed).toBe(true);
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
    expect(mockRedisClient.incr).toHaveBeenCalledWith(
      "rate:discovery:owner-1:/discovery/start",
    );
    expect(mockRedisClient.expire).toHaveBeenCalledWith(
      "rate:discovery:owner-1:/discovery/start",
      WINDOW_SECONDS,
      "NX",
    );
  });

  it("rejects the 21st request", async () => {
    mockRedisClient.exec.mockResolvedValue([
      [null, 21],
      [null, 1],
    ]);
    const service = createService();

    const allowed = await service.checkLimit("owner-1", "/discovery/start");

    expect(allowed).toBe(false);
  });

  it("allows requests when pipeline returns null", async () => {
    mockRedisClient.exec.mockResolvedValue(null);
    const service = createService();

    const allowed = await service.checkLimit("owner-1", "/discovery/start");

    expect(allowed).toBe(true);
  });

  it("uses owner + route as the key", async () => {
    mockRedisClient.exec.mockResolvedValue([
      [null, 5],
      [null, 1],
    ]);
    const service = createService();

    await service.checkLimit("owner-2", "/discovery/:sessionId/respond");

    expect(mockRedisClient.incr).toHaveBeenCalledWith(
      "rate:discovery:owner-2:/discovery/:sessionId/respond",
    );
  });
});

describe("DiscoveryRateLimitGuard with Redis limiter", () => {
  function createGuard(allowed: boolean) {
    const limiter = {
      checkLimit: jest.fn().mockResolvedValue(allowed),
    } as unknown as jest.Mocked<DiscoveryRedisLimiterService>;
    const guard = new (require("./discovery-rate-limit.guard").DiscoveryRateLimitGuard)(
      limiter,
    );
    return { guard, limiter };
  }

  function contextFor(method: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          ip: "127.0.0.1",
          path: "/api/v1/discovery/start",
          route: { path: "/discovery/start" },
          user: { id: "owner-id" },
        }),
      }),
    };
  }

  it("allows GET status checks without consuming the POST limit", async () => {
    const { guard, limiter } = createGuard(true);

    const result = await guard.canActivate(contextFor("GET") as never);

    expect(result).toBe(true);
    expect(limiter.checkLimit).not.toHaveBeenCalled();
  });

  it("allows POSTs within the limit", async () => {
    const { guard, limiter } = createGuard(true);

    const result = await guard.canActivate(contextFor("POST") as never);

    expect(result).toBe(true);
    expect(limiter.checkLimit).toHaveBeenCalledWith(
      "owner-id",
      "/discovery/start",
    );
  });

  it("rejects POSTs over the limit with DISCOVERY_RATE_LIMITED", async () => {
    const { guard } = createGuard(false);

    await expect(
      guard.canActivate(contextFor("POST") as never),
    ).rejects.toBeInstanceOf(HttpException);

    try {
      await guard.canActivate(contextFor("POST") as never);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      const response = (error as HttpException).getResponse() as {
        code: string;
        message: string;
      };
      expect(response.code).toBe("DISCOVERY_RATE_LIMITED");
      expect(response.message).toBe("Too many discovery requests");
    }
  });
});
