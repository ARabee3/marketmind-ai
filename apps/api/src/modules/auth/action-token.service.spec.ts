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
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      actionToken: {
        updateMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((operations) => Promise.all(operations)),
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

    it("invalidates all existing unconsumed tokens of the same (userId, type) before creating", async () => {
      prisma.actionToken.updateMany.mockResolvedValue({ count: 2 });
      prisma.actionToken.create.mockResolvedValue({ id: "tok-new" });

      await service.issue("user-1", ActionTokenType.PASSWORD_RESET);

      // $transaction was called with both operations
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = prisma.$transaction.mock.calls[0][0];
      expect(txArgs).toHaveLength(2);

      // First operation: invalidate existing tokens
      const updateManyCall = prisma.actionToken.updateMany.mock.calls[0][0];
      expect(updateManyCall.where).toEqual({
        userId: "user-1",
        type: ActionTokenType.PASSWORD_RESET,
        consumedAt: null,
      });
      expect(updateManyCall.data.consumedAt).toBeInstanceOf(Date);
    });
  });

  describe("consume()", () => {
    const rawToken = "a".repeat(64);
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    it("returns userId for a valid, unexpired, unconsumed token", async () => {
      prisma.actionToken.findUnique.mockResolvedValue({
        id: "tok-1",
        userId: "user-1",
        type: ActionTokenType.PASSWORD_RESET,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000), // 1 minute from now
        consumedAt: null,
      });
      prisma.actionToken.update.mockResolvedValue({});

      const userId = await service.consume(
        rawToken,
        ActionTokenType.PASSWORD_RESET,
      );
      expect(userId).toBe("user-1");

      // Verify token was marked as consumed
      expect(prisma.actionToken.update).toHaveBeenCalledWith({
        where: { id: "tok-1" },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it("throws ACTION_TOKEN_INVALID when token is not found", async () => {
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

    it("is single-use: second consume call fails after first succeeds", async () => {
      const tokenRecord = {
        id: "tok-1",
        userId: "user-1",
        type: ActionTokenType.PASSWORD_RESET,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null as Date | null,
      };

      prisma.actionToken.findUnique.mockResolvedValue(tokenRecord);
      prisma.actionToken.update.mockImplementation(async () => {
        // Simulate the DB update marking it consumed
        tokenRecord.consumedAt = new Date();
      });

      // First consume succeeds
      await service.consume(rawToken, ActionTokenType.PASSWORD_RESET);

      // Second consume: findUnique now returns the consumed token
      try {
        await service.consume(rawToken, ActionTokenType.PASSWORD_RESET);
        fail("Expected ActionTokenError");
      } catch (error) {
        expect((error as ActionTokenError).code).toBe("ACTION_TOKEN_CONSUMED");
      }
    });
  });
});
