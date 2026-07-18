import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { emptyDiscoveryProfileState } from "../discovery/market-profile";
import { JourneyRepository } from "./journey.repository";

describe("JourneyRepository", () => {
  it("scopes the current discovery session lookup to the owner", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "owner-id",
          fullName: "Ahmed Hassan",
          email: "owner@example.com",
          isEmailVerified: true,
        }),
      },
      discoverySession: {
        findFirst: jest.fn().mockResolvedValue({
          id: "session-id",
          status: "ready_for_chat",
          languageMode: "ar-EG",
          profileState: emptyDiscoveryProfileState(),
          ownerTurnCount: 2,
          completionReason: null,
          profileDraftId: null,
          confirmedProfileVersionId: null,
          updatedAt: new Date("2026-07-17T10:00:00.000Z"),
          completedAt: null,
          intakes: [
            {
              businessName: "Nile Sweets",
              businessType: "dessert shop",
              city: "Assiut",
              area: "Assiut City",
            },
          ],
        }),
      },
      businessProfileVersion: {
        findUnique: jest.fn(),
      },
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findCurrentForOwner("owner-id");

    expect(response.session?.id).toBe("session-id");
    expect(prisma.discoverySession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerUserId: "owner-id",
          status: { not: "not_started" },
        },
      }),
    );
  });

  it("returns no journey when the owner has no discovery sessions", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "owner-id",
          fullName: null,
          email: "owner@example.com",
          isEmailVerified: true,
        }),
      },
      discoverySession: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      businessProfileVersion: {
        findUnique: jest.fn(),
      },
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findCurrentForOwner("owner-id");

    expect(response.session).toBeNull();
  });

  it("rejects unknown owners", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      discoverySession: {
        findFirst: jest.fn(),
      },
      businessProfileVersion: {
        findUnique: jest.fn(),
      },
    };
    const repository = new JourneyRepository(prisma as unknown as PrismaService);

    await expect(repository.findCurrentForOwner("missing-owner")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.discoverySession.findFirst).not.toHaveBeenCalled();
  });
});
