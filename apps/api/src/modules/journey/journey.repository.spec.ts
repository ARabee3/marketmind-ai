import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { emptyDiscoveryProfileState } from "../discovery/market-profile";
import { JourneyRepository } from "./journey.repository";

function contentCycleDelegate(cycle: unknown) {
  return { findFirst: jest.fn().mockResolvedValue(cycle) };
}

function strategyDelegate(strategy: unknown) {
  return { findUnique: jest.fn().mockResolvedValue(strategy) };
}

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
      strategy: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      contentCycle: contentCycleDelegate(null),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findCurrentForOwner("owner-id");

    expect(response.session?.id).toBe("session-id");
    expect(response.strategy).toBeNull();
    expect(prisma.strategy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerUserId: "owner-id" },
        orderBy: { createdAt: "desc" },
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
      strategy: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      contentCycle: contentCycleDelegate(null),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findCurrentForOwner("owner-id");

    expect(response.session).toBeNull();
    expect(response.strategy).toBeNull();
  });

  it("returns the most recent strategy for the owner when one exists", async () => {
    const activeStrategy = {
      id: "strategy-1",
      status: "generating",
      currentVersionId: "version-1",
      brief: {
        businessProfileVersionId: "profile-version-1",
        businessProfileVersion: {
          version: 2,
          business: {
            displayName: "Nile Sweets",
            businessType: "dessert shop",
            city: "Assiut",
            area: "Assiut City",
          },
        },
      },
    };
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
      strategy: {
        findFirst: jest.fn().mockResolvedValue(activeStrategy),
      },
      contentCycle: contentCycleDelegate(null),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findCurrentForOwner("owner-id");

    expect(response.strategy).toEqual({
      id: "strategy-1",
      status: "generating",
      currentVersionId: "version-1",
      business: {
        businessName: "Nile Sweets",
        businessType: "dessert shop",
        city: "Assiut",
        area: "Assiut City",
        profileVersion: 2,
      },
    });
  });

  it("surfaces a null business snapshot when the strategy has no brief relation", async () => {
    const activeStrategy = {
      id: "strategy-1",
      status: "generating",
      currentVersionId: "version-1",
      brief: null,
    };
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
      strategy: {
        findFirst: jest.fn().mockResolvedValue(activeStrategy),
      },
      contentCycle: contentCycleDelegate(null),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findCurrentForOwner("owner-id");

    expect(response.strategy).toEqual({
      id: "strategy-1",
      status: "generating",
      currentVersionId: "version-1",
      business: null,
    });
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
      strategy: {
        findFirst: jest.fn(),
      },
      contentCycle: contentCycleDelegate(null),
    };
    const repository = new JourneyRepository(prisma as unknown as PrismaService);

    await expect(repository.findCurrentForOwner("missing-owner")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.discoverySession.findFirst).not.toHaveBeenCalled();
  });

  it("reports no content cycle when the owner has none", async () => {
    const prisma = {
      contentCycle: contentCycleDelegate(null),
      strategy: strategyDelegate(null),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findContentForOwner("owner-id");

    expect(response).toEqual({ cycle: null, pack: null });
    expect(prisma.contentCycle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerUserId: "owner-id" },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("reports no content cycle when the cycle's strategy no longer exists", async () => {
    const prisma = {
      contentCycle: contentCycleDelegate({
        id: "cycle-1",
        strategyId: "strategy-1",
        status: "active",
        currentWeekNumber: 1,
        packs: [],
      }),
      strategy: strategyDelegate(null),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findContentForOwner("owner-id");

    expect(response).toEqual({ cycle: null, pack: null });
    expect(prisma.strategy.findUnique).toHaveBeenCalledWith({
      where: { id: "strategy-1" },
      select: { ownerUserId: true },
    });
  });

  it("reports no content cycle when the cycle's strategy belongs to another owner", async () => {
    const prisma = {
      contentCycle: contentCycleDelegate({
        id: "cycle-1",
        strategyId: "strategy-1",
        status: "active",
        currentWeekNumber: 1,
        packs: [],
      }),
      strategy: strategyDelegate({ ownerUserId: "other-owner" }),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findContentForOwner("owner-id");

    expect(response).toEqual({ cycle: null, pack: null });
  });

  it("counts pending decisions from non-final items in the latest pack", async () => {
    const prisma = {
      contentCycle: contentCycleDelegate({
        id: "cycle-1",
        strategyId: "strategy-1",
        status: "active",
        currentWeekNumber: 2,
        packs: [
          {
            id: "pack-1",
            status: "draft",
            weekNumber: 2,
            items: [
              { status: "draft" },
              { status: "draft" },
              { status: "approved" },
              { status: "rejected" },
            ],
          },
        ],
      }),
      strategy: strategyDelegate({ ownerUserId: "owner-id" }),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findContentForOwner("owner-id");

    expect(response.cycle).toEqual({
      id: "cycle-1",
      status: "active",
      currentWeekNumber: 2,
    });
    expect(response.pack).toEqual({
      id: "pack-1",
      status: "draft",
      weekNumber: 2,
      pendingDecisions: 2,
    });
  });

  it("reports a null pack when the active cycle has no packs yet", async () => {
    const prisma = {
      contentCycle: contentCycleDelegate({
        id: "cycle-1",
        strategyId: "strategy-1",
        status: "active",
        currentWeekNumber: 1,
        packs: [],
      }),
      strategy: strategyDelegate({ ownerUserId: "owner-id" }),
    };
    const repository = new JourneyRepository(prisma as never);

    const response = await repository.findContentForOwner("owner-id");

    expect(response.cycle?.id).toBe("cycle-1");
    expect(response.pack).toBeNull();
  });
});
