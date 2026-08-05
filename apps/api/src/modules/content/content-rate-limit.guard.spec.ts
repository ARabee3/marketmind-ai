import { HttpException, HttpStatus } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { ContentRateLimitGuard } from "./content-rate-limit.guard";

const WINDOW_SECONDS = 60;

function createGuard(count: number | null): {
  guard: ContentRateLimitGuard;
  mockRedisClient: {
    pipeline: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
    exec: jest.Mock;
  };
} {
  const mockRedisClient = {
    pipeline: jest.fn().mockReturnThis(),
    incr: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest
      .fn()
      .mockResolvedValue(count === null ? null : [[null, count], [null, 1]]),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  } as unknown as jest.Mocked<RedisService>;

  const guard = new ContentRateLimitGuard(mockRedisService);
  return { guard, mockRedisClient };
}

function contextFor(
  method: string,
  path: string,
  user: { id: string } | undefined,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        path,
        ip: "127.0.0.1",
        user,
      }),
    }),
  };
}

describe("ContentRateLimitGuard", () => {
  it("allows GET requests without consuming the POST limit", async () => {
    const { guard, mockRedisClient } = createGuard(1);

    const result = await guard.canActivate(
      contextFor("GET", "/api/v1/content-packs/pack-1", { id: "owner-1" }) as never,
    );

    expect(result).toBe(true);
    expect(mockRedisClient.pipeline).not.toHaveBeenCalled();
  });

  it("allows POSTs within the default limit (20/min)", async () => {
    const { guard, mockRedisClient } = createGuard(20);

    const result = await guard.canActivate(
      contextFor("POST", "/api/v1/content-cycles", { id: "owner-1" }) as never,
    );

    expect(result).toBe(true);
    expect(mockRedisClient.pipeline).toHaveBeenCalled();
    expect(mockRedisClient.incr).toHaveBeenCalledWith(
      "rate:content:owner-1:default",
    );
    expect(mockRedisClient.expire).toHaveBeenCalledWith(
      "rate:content:owner-1:default",
      WINDOW_SECONDS,
      "NX",
    );
  });

  it("rejects the 6th generate POST in a minute with CONTENT_RATE_LIMITED", async () => {
    const { guard } = createGuard(6);

    await expect(
      guard.canActivate(
        contextFor("POST", "/api/v1/content-cycles/c-1/weeks/1/generate", {
          id: "owner-1",
        }) as never,
      ),
    ).rejects.toBeInstanceOf(HttpException);

    try {
      await guard.canActivate(
        contextFor("POST", "/api/v1/content-cycles/c-1/weeks/1/generate", {
          id: "owner-1",
        }) as never,
      );
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      const response = (error as HttpException).getResponse() as {
        code: string;
        message: string;
      };
      expect(response.code).toBe("CONTENT_RATE_LIMITED");
    }
  });

  it("rejects the 11th decisions POST in a minute", async () => {
    const { guard } = createGuard(11);

    await expect(
      guard.canActivate(
        contextFor("POST", "/api/v1/content-packs/p-1/decisions/bulk", {
          id: "owner-1",
        }) as never,
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("allows POSTs within the generate limit (5/min)", async () => {
    const { guard, mockRedisClient } = createGuard(5);

    const result = await guard.canActivate(
      contextFor("POST", "/api/v1/content-cycles/c-1/weeks/1/generate", {
        id: "owner-1",
      }) as never,
    );

    expect(result).toBe(true);
    expect(mockRedisClient.incr).toHaveBeenCalledWith(
      "rate:content:owner-1:generate",
    );
  });

  it("allows requests when the pipeline returns null (permissive failure)", async () => {
    const { guard } = createGuard(null);

    const result = await guard.canActivate(
      contextFor("POST", "/api/v1/content-cycles", { id: "owner-1" }) as never,
    );

    expect(result).toBe(true);
  });

  it("scopes the budget per owner", async () => {
    const { guard, mockRedisClient } = createGuard(1);

    await guard.canActivate(
      contextFor("POST", "/api/v1/content-cycles", { id: "owner-2" }) as never,
    );

    expect(mockRedisClient.incr).toHaveBeenCalledWith(
      "rate:content:owner-2:default",
    );
  });

  it("falls back to the client ip when no user is present", async () => {
    const { guard, mockRedisClient } = createGuard(1);

    await guard.canActivate(
      contextFor("POST", "/api/v1/content-cycles", undefined) as never,
    );

    expect(mockRedisClient.incr).toHaveBeenCalledWith(
      "rate:content:127.0.0.1:default",
    );
  });
});
