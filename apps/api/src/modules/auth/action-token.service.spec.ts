import { Test, TestingModule } from "@nestjs/testing";
import { createHash } from "node:crypto";
import { ActionTokenType } from "@prisma/client";

import { PrismaService } from "../../common/persistence/prisma.service";
import { ActionTokenService, ActionTokenError } from "./action-token.service";

describe("ActionTokenService", () => {
  let service: ActionTokenService;
  let prisma: {
    actionToken: {
      updateMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      actionToken: {
        updateMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      // Interactive transaction: passes a tx proxy to the callback.
      // The proxy delegates to the same mocks on prisma.actionToken.
      $transaction: jest.fn(async (fnOrArray, _options?) => {
        if (typeof fnOrArray === "function") {
          // Interactive transaction — call the function with a proxy
          // that delegates to the same actionToken mocks.
          return fnOrArray({
            actionToken: prisma.actionToken,
          });
        }
        // Batched transaction fallback
        return Promise.all(fnOrArray);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActionTokenService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ActionTokenService);
  });

  describe("issue()", () => {
    it("returns a raw token that is NOT stored in the database", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.create.mockResolvedValue({ id: "tok-1" });

      const result = await service.issue(
        "user-1",
        ActionTokenType.PASSWORD_RESET,
      );

      // Raw token is a 64-char hex string (32 bytes)
      expect(result.rawToken).toHaveLength(64);
      expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/);

      // The DB was called with the SHA-256 hash, NOT the raw token
      const createCall = prisma.actionToken.create.mock.calls[0][0];
      const expectedHash = createHash("sha256")
        .update(result.rawToken)
        .digest("hex");
      expect(createCall.data.tokenHash).toBe(expectedHash);
      expect(createCall.data.tokenHash).not.toBe(result.rawToken);
    });

    it("sets 30-minute expiry for PASSWORD_RESET tokens", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.create.mockResolvedValue({ id: "tok-1" });

      const before = Date.now();
      const result = await service.issue(
        "user-1",
        ActionTokenType.PASSWORD_RESET,
      );
      const after = Date.now();

      const thirtyMinMs = 30 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + thirtyMinMs,
      );
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
        after + thirtyMinMs,
      );
    });

    it("sets 12-hour expiry for EMAIL_VERIFICATION tokens", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.create.mockResolvedValue({ id: "tok-1" });

      const before = Date.now();
      const result = await service.issue(
        "user-1",
        ActionTokenType.EMAIL_VERIFICATION,
      );
      const after = Date.now();

      const twelveHoursMs = 12 * 60 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + twelveHoursMs,
      );
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
        after + twelveHoursMs,
      );
    });

    it("uses an interactive transaction with Serializable isolation", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.create.mockResolvedValue({ id: "tok-new" });

      await service.issue("user-1", ActionTokenType.PASSWORD_RESET);

      // $transaction was called with a function (interactive), not an array
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = prisma.$transaction.mock.calls[0];
      expect(typeof txArgs[0]).toBe("function");
      expect(txArgs[1]).toEqual({ isolationLevel: "Serializable" });
    });

    it("invalidates all existing unconsumed tokens before creating", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 2 });
      prisma.actionToken.create.mockResolvedValue({ id: "tok-new" });

      await service.issue("user-1", ActionTokenType.PASSWORD_RESET);

      // updateMany was called first to invalidate
      const updateManyCall = prisma.actionToken.updateMany.mock.calls[0][0];
      expect(updateManyCall.where).toEqual({
        userId: "user-1",
        type: ActionTokenType.PASSWORD_RESET,
        consumedAt: null,
      });
      expect(updateManyCall.data.consumedAt).toBeInstanceOf(Date);

      // create was called after
      expect(prisma.actionToken.create).toHaveBeenCalledTimes(1);
    });

    it("concurrent reissue: serializable isolation prevents two active tokens", async () => {
      // Simulate two concurrent issue() calls. Because $transaction uses
      // Serializable isolation, only one can succeed. The DB would throw
      // a serialization failure on the second, which Prisma retries or
      // rejects. Here we verify the isolation level is correctly requested.
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.create.mockResolvedValue({ id: "tok-1" });

      const [result1, result2] = await Promise.all([
        service.issue("user-1", ActionTokenType.PASSWORD_RESET),
        service.issue("user-1", ActionTokenType.PASSWORD_RESET),
      ]);

      // Both calls request Serializable isolation
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: "Serializable",
      });
      expect(prisma.$transaction.mock.calls[1][1]).toEqual({
        isolationLevel: "Serializable",
      });

      // Both produce different raw tokens
      expect(result1.rawToken).not.toBe(result2.rawToken);
    });
  });

  describe("consume()", () => {
    const rawToken = "a".repeat(64);
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    it("returns userId via atomic conditional update for a valid token", async () => {
      // updateMany succeeds (1 row matched)
      prisma.actionToken.updateMany.mockResolvedValue({ count: 1 });
      // follow-up findUnique to get the userId
      prisma.actionToken.findUnique.mockResolvedValue({
        userId: "user-1",
      });

      const userId = await service.consume(
        rawToken,
        ActionTokenType.PASSWORD_RESET,
      );
      expect(userId).toBe("user-1");

      // Verify the atomic conditional update was used
      expect(prisma.actionToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash,
          type: ActionTokenType.PASSWORD_RESET,
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it("throws ACTION_TOKEN_INVALID when token is not found", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.findUnique.mockResolvedValue(null);

      await expect(
        service.consume(rawToken, ActionTokenType.PASSWORD_RESET),
      ).rejects.toThrow(ActionTokenError);

      try {
        await service.consume(rawToken, ActionTokenType.PASSWORD_RESET);
      } catch (error) {
        expect((error as ActionTokenError).code).toBe("ACTION_TOKEN_INVALID");
      }
    });

    it("throws ACTION_TOKEN_INVALID when token type does not match", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.findUnique.mockResolvedValue({
        id: "tok-1",
        userId: "user-1",
        type: ActionTokenType.EMAIL_VERIFICATION, // wrong type
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
      });

      try {
        await service.consume(rawToken, ActionTokenType.PASSWORD_RESET);
        fail("Expected ActionTokenError");
      } catch (error) {
        expect(error).toBeInstanceOf(ActionTokenError);
        expect((error as ActionTokenError).code).toBe("ACTION_TOKEN_INVALID");
      }
    });

    it("throws ACTION_TOKEN_CONSUMED when token has already been used", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.findUnique.mockResolvedValue({
        id: "tok-1",
        userId: "user-1",
        type: ActionTokenType.PASSWORD_RESET,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(), // already consumed
      });

      try {
        await service.consume(rawToken, ActionTokenType.PASSWORD_RESET);
        fail("Expected ActionTokenError");
      } catch (error) {
        expect(error).toBeInstanceOf(ActionTokenError);
        expect((error as ActionTokenError).code).toBe("ACTION_TOKEN_CONSUMED");
      }
    });

    it("throws ACTION_TOKEN_EXPIRED when token has expired", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.actionToken.findUnique.mockResolvedValue({
        id: "tok-1",
        userId: "user-1",
        type: ActionTokenType.PASSWORD_RESET,
        tokenHash,
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
        consumedAt: null,
      });

      try {
        await service.consume(rawToken, ActionTokenType.PASSWORD_RESET);
        fail("Expected ActionTokenError");
      } catch (error) {
        expect(error).toBeInstanceOf(ActionTokenError);
        expect((error as ActionTokenError).code).toBe("ACTION_TOKEN_EXPIRED");
      }
    });

    it("concurrent consume: only the first caller succeeds", async () => {
      // First call: updateMany matches 1 row (consumes it)
      // Second call: updateMany matches 0 rows (already consumed)
      let consumeCount = 0;
      prisma.actionToken.updateMany.mockImplementation(async () => {
        consumeCount++;
        if (consumeCount === 1) {
          return { count: 1 }; // first caller wins
        }
        return { count: 0 }; // second caller loses
      });

      // First call gets the userId
      prisma.actionToken.findUnique
        .mockResolvedValueOnce({ userId: "user-1" }) // for first consume success
        .mockResolvedValueOnce({
          // for second consume failure diagnosis
          id: "tok-1",
          userId: "user-1",
          type: ActionTokenType.PASSWORD_RESET,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(), // already consumed by the first caller
        });

      const results = await Promise.allSettled([
        service.consume(rawToken, ActionTokenType.PASSWORD_RESET),
        service.consume(rawToken, ActionTokenType.PASSWORD_RESET),
      ]);

      // First succeeds
      expect(results[0].status).toBe("fulfilled");
      expect((results[0] as PromiseFulfilledResult<string>).value).toBe(
        "user-1",
      );

      // Second fails with CONSUMED
      expect(results[1].status).toBe("rejected");
      expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
        ActionTokenError,
      );
      expect(
        ((results[1] as PromiseRejectedResult).reason as ActionTokenError).code,
      ).toBe("ACTION_TOKEN_CONSUMED");
    });
  });
});
