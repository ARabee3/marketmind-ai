import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../common/persistence/prisma.service";
import {
  FederatedIdentityService,
  FederatedIdentityConflictError,
} from "./federated-identity.service";

describe("FederatedIdentityService", () => {
  let service: FederatedIdentityService;
  let prisma: {
    federatedIdentity: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      federatedIdentity: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FederatedIdentityService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(FederatedIdentityService);
  });

  describe("findOrCreate()", () => {
    const baseParams = {
      userId: "user-1",
      provider: "google",
      providerSubject: "google-sub-123",
      email: "test@example.com",
      displayName: "Test User",
    };

    it("returns existing identity with isNew=false when link already exists for the same user", async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        id: "fi-1",
        userId: "user-1",
      });

      const result = await service.findOrCreate(baseParams);

      expect(result).toEqual({ id: "fi-1", userId: "user-1", isNew: false });
      expect(prisma.federatedIdentity.create).not.toHaveBeenCalled();
    });

    it("creates a new link with isNew=true when no existing identity", async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);
      prisma.federatedIdentity.create.mockResolvedValue({
        id: "fi-new",
        userId: "user-1",
      });

      const result = await service.findOrCreate(baseParams);

      expect(result).toEqual({ id: "fi-new", userId: "user-1", isNew: true });
      expect(prisma.federatedIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          provider: "google",
          providerSubject: "google-sub-123",
          email: "test@example.com",
          displayName: "Test User",
        }),
        select: { id: true, userId: true },
      });
    });

    it("throws FederatedIdentityConflictError when identity belongs to a different user", async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        id: "fi-1",
        userId: "other-user", // different user
      });

      await expect(service.findOrCreate(baseParams)).rejects.toThrow(
        FederatedIdentityConflictError,
      );
    });

    it("throws FederatedIdentityConflictError on P2002 unique constraint violation (race condition)", async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "6.0.0" },
      );
      prisma.federatedIdentity.create.mockRejectedValue(p2002Error);

      await expect(service.findOrCreate(baseParams)).rejects.toThrow(
        FederatedIdentityConflictError,
      );
    });

    it("has code FEDERATED_IDENTITY_CONFLICT on conflict errors", async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        id: "fi-1",
        userId: "other-user",
      });

      try {
        await service.findOrCreate(baseParams);
        fail("Expected FederatedIdentityConflictError");
      } catch (error) {
        expect((error as FederatedIdentityConflictError).code).toBe(
          "FEDERATED_IDENTITY_CONFLICT",
        );
      }
    });
  });

  describe("findByProvider()", () => {
    it("returns the identity when it exists", async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue({
        id: "fi-1",
        userId: "user-1",
      });

      const result = await service.findByProvider("google", "google-sub-123");

      expect(result).toEqual({ id: "fi-1", userId: "user-1" });
      expect(prisma.federatedIdentity.findUnique).toHaveBeenCalledWith({
        where: {
          provider_providerSubject: {
            provider: "google",
            providerSubject: "google-sub-123",
          },
        },
        select: { id: true, userId: true },
      });
    });

    it("returns null when no identity exists", async () => {
      prisma.federatedIdentity.findUnique.mockResolvedValue(null);

      const result = await service.findByProvider("google", "nonexistent");
      expect(result).toBeNull();
    });
  });
});
