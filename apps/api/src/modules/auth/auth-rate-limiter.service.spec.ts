/**
 * Tests for AuthRateLimiterService.
 *
 * We construct the service directly with a mock RedisService to avoid
 * pulling in the real ioredis module (which requires native bindings).
 */

import { AuthRateLimiterService } from "./auth-rate-limiter.service";

describe("AuthRateLimiterService", () => {
  let service: AuthRateLimiterService;
  let mockPipeline: { incr: jest.Mock; expire: jest.Mock; exec: jest.Mock };
  let mockRedisClient: { pipeline: jest.Mock };

  beforeEach(() => {
    mockPipeline = {
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };
    mockRedisClient = {
      pipeline: jest.fn().mockReturnValue(mockPipeline),
    };

    // Construct directly — RedisService is fully mocked.
    const mockRedisService = { getClient: () => mockRedisClient } as any;
    service = new AuthRateLimiterService(mockRedisService);
  });

  describe("key isolation", () => {
    it("uses rate:auth: prefix, NOT rate:discovery:", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 1]]);

      await service.checkLimit("login", "test@example.com");

      expect(mockPipeline.incr).toHaveBeenCalledWith(
        "rate:auth:login:test@example.com",
      );
    });

    it("uses different keys for different actions", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 1]]);

      await service.checkLimit("login", "test@example.com");
      await service.checkLimit("password-reset", "test@example.com");

      const incrCalls = mockPipeline.incr.mock.calls;
      expect(incrCalls[0][0]).toBe("rate:auth:login:test@example.com");
      expect(incrCalls[1][0]).toBe("rate:auth:password-reset:test@example.com");
    });
  });

  describe("login rate limit (5 per 15 min)", () => {
    it("allows the first 5 login attempts", async () => {
      for (let count = 1; count <= 5; count++) {
        mockPipeline.exec.mockResolvedValueOnce([[null, count]]);
        const allowed = await service.checkLimit("login", "test@example.com");
        expect(allowed).toBe(true);
      }
    });

    it("rejects the 6th login attempt", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 6]]);
      const allowed = await service.checkLimit("login", "test@example.com");
      expect(allowed).toBe(false);
    });

    it("uses 900-second window for login", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 1]]);
      await service.checkLimit("login", "test@example.com");

      expect(mockPipeline.expire).toHaveBeenCalledWith(
        "rate:auth:login:test@example.com",
        900,
        "NX",
      );
    });
  });

  describe("password-reset rate limit (3 per 15 min)", () => {
    it("allows the first 3 password-reset requests", async () => {
      for (let count = 1; count <= 3; count++) {
        mockPipeline.exec.mockResolvedValueOnce([[null, count]]);
        const allowed = await service.checkLimit(
          "password-reset",
          "test@example.com",
        );
        expect(allowed).toBe(true);
      }
    });

    it("rejects the 4th password-reset request", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 4]]);
      const allowed = await service.checkLimit(
        "password-reset",
        "test@example.com",
      );
      expect(allowed).toBe(false);
    });
  });

  describe("verify-email rate limit (3 per hour)", () => {
    it("allows the first 3 verify-email requests", async () => {
      for (let count = 1; count <= 3; count++) {
        mockPipeline.exec.mockResolvedValueOnce([[null, count]]);
        const allowed = await service.checkLimit("verify-email", "user-1");
        expect(allowed).toBe(true);
      }
    });

    it("rejects the 4th verify-email request", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 4]]);
      const allowed = await service.checkLimit("verify-email", "user-1");
      expect(allowed).toBe(false);
    });

    it("uses 3600-second window for verify-email", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 1]]);
      await service.checkLimit("verify-email", "user-1");

      expect(mockPipeline.expire).toHaveBeenCalledWith(
        "rate:auth:verify-email:user-1",
        3600,
        "NX",
      );
    });
  });

  describe("pipeline failure", () => {
    it("returns true (permissive) when pipeline fails", async () => {
      mockPipeline.exec.mockResolvedValue(null);
      const allowed = await service.checkLimit("login", "test@example.com");
      expect(allowed).toBe(true);
    });
  });

  describe("unknown actions", () => {
    it("falls back to default limit (10 per 60s) for unknown actions", async () => {
      mockPipeline.exec.mockResolvedValue([[null, 10]]);
      const allowed = await service.checkLimit("unknown-action", "someone");
      expect(allowed).toBe(true);

      mockPipeline.exec.mockResolvedValue([[null, 11]]);
      const rejected = await service.checkLimit("unknown-action", "someone");
      expect(rejected).toBe(false);
    });
  });
});
