import { OAuthStateService, OAuthStatePayload } from "./oauth-state.service";
import { OAuthException } from "./exceptions/oauth.exception";

describe("OAuthStateService", () => {
  let service: OAuthStateService;
  let mockPipeline: {
    get: jest.Mock;
    del: jest.Mock;
    exec: jest.Mock;
  };
  let mockRedisClient: {
    setex: jest.Mock;
    pipeline: jest.Mock;
  };

  beforeEach(() => {
    mockPipeline = {
      get: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };
    mockRedisClient = {
      setex: jest.fn(),
      pipeline: jest.fn().mockReturnValue(mockPipeline),
    };

    const mockRedisService = { getClient: () => mockRedisClient } as any;
    service = new OAuthStateService(mockRedisService);
  });

  describe("createState()", () => {
    it("generates a unique base64url state string", async () => {
      mockRedisClient.setex.mockResolvedValue("OK");

      const state1 = await service.createState("google");
      const state2 = await service.createState("google");

      expect(state1).not.toBe(state2);
      expect(state1).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(state2).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(state1.length).toBeGreaterThanOrEqual(32);
    });

    it("stores the state with provider and optional fingerprint", async () => {
      mockRedisClient.setex.mockResolvedValue("OK");

      await service.createState("google", "fp-123");

      expect(mockRedisClient.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, rawPayload] = mockRedisClient.setex.mock.calls[0];
      expect(key).toMatch(/^oauth:state:/);
      expect(ttl).toBe(600);

      const payload = JSON.parse(rawPayload) as OAuthStatePayload;
      expect(payload.provider).toBe("google");
      expect(payload.fingerprint).toBe("fp-123");
    });
  });

  describe("consumeState()", () => {
    it("returns the stored payload for a valid state", async () => {
      const payload: OAuthStatePayload = {
        provider: "google",
        fingerprint: "fp-123",
      };
      mockPipeline.exec.mockResolvedValue([[null, JSON.stringify(payload)], [null, 1]]);

      const result = await service.consumeState("valid-state-nonce-123456789", "fp-123");

      expect(result).toEqual(payload);
      expect(mockPipeline.get).toHaveBeenCalledWith("oauth:state:valid-state-nonce-123456789");
      expect(mockPipeline.del).toHaveBeenCalledWith("oauth:state:valid-state-nonce-123456789");
    });

    it("rejects a missing state", async () => {
      await expect(service.consumeState(undefined)).rejects.toThrow(
        OAuthException,
      );
      await expect(service.consumeState("")).rejects.toThrow(OAuthException);
    });

    it("rejects a state that does not exist in Redis", async () => {
      mockPipeline.exec.mockResolvedValue([[null, null], [null, 0]]);

      await expect(service.consumeState("unknown-state")).rejects.toThrow(
        OAuthException,
      );
    });

    it("rejects a replayed state after it has been consumed", async () => {
      const payload: OAuthStatePayload = { provider: "google" };
      mockPipeline.exec
        .mockResolvedValueOnce([[null, JSON.stringify(payload)], [null, 1]])
        .mockResolvedValueOnce([[null, null], [null, 0]]);

      await service.consumeState("one-time-state-nonce-123456");
      await expect(service.consumeState("one-time-state-nonce-123456")).rejects.toThrow(
        OAuthException,
      );
    });

    it("rejects a corrupted payload", async () => {
      mockPipeline.exec.mockResolvedValue([[null, "not-json"], [null, 1]]);

      await expect(service.consumeState("corrupt-state")).rejects.toThrow(
        OAuthException,
      );
    });

    it("rejects a fingerprint mismatch", async () => {
      const payload: OAuthStatePayload = {
        provider: "google",
        fingerprint: "fp-original",
      };
      mockPipeline.exec.mockResolvedValue([[null, JSON.stringify(payload)], [null, 1]]);

      await expect(
        service.consumeState("valid-state-fp-check-123456", "fp-different"),
      ).rejects.toThrow(OAuthException);
    });

    it("allows consumption when no fingerprint was stored", async () => {
      const payload: OAuthStatePayload = { provider: "google" };
      mockPipeline.exec.mockResolvedValue([[null, JSON.stringify(payload)], [null, 1]]);

      const result = await service.consumeState("valid-state-no-fp-123456", "fp-any");

      expect(result.provider).toBe("google");
    });

    it("rejects when the Redis pipeline fails", async () => {
      mockPipeline.exec.mockResolvedValue(null);

      await expect(service.consumeState("any-state")).rejects.toThrow(
        OAuthException,
      );
    });

    it("exposes OAUTH_STATE_MISMATCH code on errors", async () => {
      mockPipeline.exec.mockResolvedValue([[null, null], [null, 0]]);

      await expect(service.consumeState("missing")).rejects.toMatchObject({
        code: "OAUTH_STATE_MISMATCH",
      });
    });
  });
});
