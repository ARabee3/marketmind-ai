import { FacebookTargetBridgeService } from "../facebook-target-bridge.service";

type PrismaMock = {
  publishingTarget: {
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
};

function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    business: {
      findUnique: jest.fn().mockResolvedValue({ ownerUserId: "owner-1" }),
    },
    socialConnection: {
      findUnique: jest.fn().mockResolvedValue({
        id: "social-1",
        userId: "owner-1",
        provider: "facebook",
        pageId: "page-1",
        pageName: "MarketMind Page",
        isValid: true,
        connectedAt: new Date("2026-08-09T08:00:00.000Z"),
        lastTestedAt: null,
      }),
    },
    publishingTarget: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };
  return prisma as unknown as PrismaMock;
}

describe("FacebookTargetBridgeService", () => {
  it("materializes the PR #193 SocialConnection as a non-secret target", async () => {
    const prisma = makePrisma();
    const service = new FacebookTargetBridgeService(prisma as never);

    await service.syncForBusiness("business-1");

    expect(prisma.publishingTarget.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          businessId: "business-1",
          externalAccountId: "page-1",
          displayName: "MarketMind Page",
          connectionState: "CONNECTED",
          credentialRef: "facebook-social-connection:social-1",
          capabilities: ["static_image"],
        }),
      }),
    );
    const serialized = JSON.stringify(
      prisma.publishingTarget.upsert.mock.calls[0][0],
    );
    expect(serialized).not.toContain("encryptedToken");
    expect(serialized).not.toContain("access_token");
  });

  it("expires bridged targets when the owner disconnects", async () => {
    const prisma = makePrisma({
      socialConnection: { findUnique: jest.fn().mockResolvedValue(null) },
      publishingTarget: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "target-1",
            credentialRef: "facebook-social-connection:social-old",
            connectionState: "CONNECTED",
          },
        ]),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const service = new FacebookTargetBridgeService(prisma as never);

    await service.syncForBusiness("business-1");

    expect(prisma.publishingTarget.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["target-1"] } },
      data: { connectionState: "EXPIRED", version: { increment: 1 } },
    });
  });
});
