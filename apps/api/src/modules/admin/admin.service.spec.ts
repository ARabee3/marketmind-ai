import { Test, TestingModule } from "@nestjs/testing";
import {
  AdminService,
  computeMrrEgp,
  RevenueSummary,
} from "./admin.service";
import { PrismaService } from "../../common/persistence/prisma.service";

describe("computeMrrEgp", () => {
  it("returns 0 for an empty subscription list", () => {
    expect(computeMrrEgp([])).toBe(0);
  });

  it("sums monthly subscriptions at full amountEgp", () => {
    expect(
      computeMrrEgp([
        { amountEgp: 299, interval: "monthly", periodDays: 30 },
      ]),
    ).toBe(299);
  });

  it("divides yearly subscriptions by 12", () => {
    expect(
      computeMrrEgp([
        { amountEgp: 2990, interval: "yearly", periodDays: 365 },
      ]),
    ).toBe(249); // 2990/12 = 249.17 → rounded to 249
  });

  it("uses periodDays fallback for non-monthly/non-yearly intervals", () => {
    expect(
      computeMrrEgp([
        { amountEgp: 100, interval: "trial", periodDays: 14 },
      ]),
    ).toBe(214); // 100*30/14 = 214.29 → rounded to 214
  });

  it("rounds the final sum to an integer", () => {
    expect(
      computeMrrEgp([
        { amountEgp: 299, interval: "monthly", periodDays: 30 },
        { amountEgp: 2990, interval: "yearly", periodDays: 365 },
      ]),
    ).toBe(548); // 299 + 249.17 = 548.17 → rounded to 548
  });

  it("handles mixed monthly + yearly + custom intervals", () => {
    expect(
      computeMrrEgp([
        { amountEgp: 299, interval: "monthly", periodDays: 30 },
        { amountEgp: 2990, interval: "yearly", periodDays: 365 },
        { amountEgp: 249, interval: "founding_pilot", periodDays: 30 },
      ]),
    ).toBe(797); // 299 + 249.17 + 249 = 797.17 → rounded to 797
  });
});

describe("AdminService", () => {
  let service: AdminService;
  let prisma: {
    user: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
    refreshSession: { findMany: jest.Mock };
    federatedIdentity: { findMany: jest.Mock };
    business: { findMany: jest.Mock; count: jest.Mock };
    billingSubscription: { findMany: jest.Mock; count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      refreshSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      federatedIdentity: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      business: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      billingSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  describe("getUsers", () => {
    it("returns paginated empty list when no users exist", async () => {
      const result = await service.getUsers(1, 20);
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    });

    it("maps user fields to UserRow shape", async () => {
      const mockUser = {
        id: "u1",
        fullName: "Test User",
        email: "test@example.com",
        roles: ["OWNER"],
        status: "active",
        createdAt: new Date("2024-01-01"),
        lastLoginAt: new Date("2024-06-01"),
        businesses: [{ id: "b1" }],
        refreshSessions: [{ id: "s1" }],
      };
      prisma.user.findMany.mockResolvedValue([mockUser]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.getUsers(1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "u1",
        fullName: "Test User",
        email: "test@example.com",
        roles: ["OWNER"],
        status: "active",
        businessCount: 1,
        activeSessionCount: 1,
      });
    });

    it("applies search filter when provided", async () => {
      await service.getUsers(1, 20, "test");
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              {
                email: {
                  contains: "test",
                  mode: "insensitive",
                },
              },
              {
                fullName: {
                  contains: "test",
                  mode: "insensitive",
                },
              },
            ]),
          }),
        }),
      );
    });

    it("passes pagination offset correctly", async () => {
      await service.getUsers(3, 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });
  });

  describe("getUserById", () => {
    it("returns null when user not found", async () => {
      const result = await service.getUserById("nonexistent");
      expect(result).toBeNull();
    });

    it("returns full user detail with relations", async () => {
      const mockUser = {
        id: "u1",
        fullName: "Detail User",
        email: "detail@example.com",
        roles: ["OWNER"],
        status: "active",
        createdAt: new Date("2024-01-01"),
        lastLoginAt: new Date("2024-06-01"),
      };
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshSession.findMany.mockResolvedValue([
        {
          id: "s1",
          userAgent: "Chrome",
          ipAddress: "127.0.0.1",
          expiresAt: new Date("2025-01-01"),
          createdAt: new Date("2024-01-01"),
        },
      ]);
      prisma.federatedIdentity.findMany.mockResolvedValue([
        { id: "fi1", provider: "google", displayName: "G User", email: "g@example.com" },
      ]);
      prisma.business.findMany.mockResolvedValue([
        { id: "b1", displayName: "Biz", status: "active", createdAt: new Date("2024-01-01") },
      ]);

      const result = await service.getUserById("u1");
      expect(result).toBeDefined();
      if (result) {
        expect(result.user.id).toBe("u1");
        expect(result.activeSessions).toHaveLength(1);
        expect(result.federatedIdentities).toHaveLength(1);
        expect(result.businesses).toHaveLength(1);
        expect(result.user.businessCount).toBe(1);
        expect(result.user.activeSessionCount).toBe(1);
      }
    });
  });

  describe("getRevenueSummary", () => {
    it("returns zeroes when no data exists", async () => {
      const result = await service.getRevenueSummary();
      expect(result).toEqual({
        activeBusinesses: 0,
        activeSubscriptions: 0,
        trialingCount: 0,
        mrrEgp: 0,
      });
    });

    it("computes MRR from active subscriptions", async () => {
      prisma.business.count.mockResolvedValue(3);
      prisma.billingSubscription.findMany.mockResolvedValue([
        {
          state: "active",
          price: { amountEgp: 299, interval: "monthly", periodDays: 30 },
        },
        {
          state: "active",
          price: { amountEgp: 2990, interval: "yearly", periodDays: 365 },
        },
      ]);
      prisma.billingSubscription.count.mockResolvedValue(1);

      const result = await service.getRevenueSummary();
      expect(result).toMatchObject({
        activeBusinesses: 3,
        activeSubscriptions: 2,
        trialingCount: 1,
      });
      expect(result.mrrEgp).toBe(548); // 299 + 249.17
    });
  });

  describe("getSubscriptions", () => {
    it("returns paginated empty list", async () => {
      const result = await service.getSubscriptions(1, 20);
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    });

    it("maps subscription fields to SubscriptionRow shape", async () => {
      prisma.billingSubscription.findMany.mockResolvedValue([
        {
          id: "sub1",
          state: "active",
          paidThroughAt: new Date("2025-01-01"),
          createdAt: new Date("2024-01-01"),
          billingAccount: {
            ownerUser: { email: "own@test.com", fullName: "Owner" },
          },
          price: {
            displayNameEn: "Growth",
            planCode: "growth",
            amountEgp: 299,
            interval: "monthly",
          },
        },
      ]);
      prisma.billingSubscription.count.mockResolvedValue(1);

      const result = await service.getSubscriptions(1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "sub1",
        state: "active",
        ownerEmail: "own@test.com",
        ownerName: "Owner",
        priceDisplayNameEn: "Growth",
        planCode: "growth",
        amountEgp: 299,
        interval: "monthly",
      });
    });
  });
});
