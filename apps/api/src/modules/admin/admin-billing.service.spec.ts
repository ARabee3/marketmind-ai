import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AdminBillingService } from "./admin-billing.service";
import { PrismaService } from "../../common/persistence/prisma.service";
import { AuditService } from "../audit/audit.service";

describe("AdminBillingService", () => {
  let service: AdminBillingService;
  let prisma: {
    billingAccount: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    billingProviderCostLedger: {
      findMany: jest.Mock;
    };
    billingCheckoutAttempt: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    billingProviderEvent: {
      findMany: jest.Mock;
    };
    billingPaymentTransaction: {
      findMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
    };
    billingPointBalance: {
      aggregate: jest.Mock;
      update: jest.Mock;
    };
    billingPointLedger: {
      findMany: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: {
    record: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      billingAccount: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      billingProviderCostLedger: {
        findMany: jest.fn(),
      },
      billingCheckoutAttempt: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      billingProviderEvent: {
        findMany: jest.fn(),
      },
      billingPaymentTransaction: {
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      billingPointBalance: {
        aggregate: jest.fn(),
        update: jest.fn(),
      },
      billingPointLedger: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    audit = {
      record: jest.fn().mockResolvedValue({ id: "audit-1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<AdminBillingService>(AdminBillingService);
  });

  describe("pauseAccount", () => {
    it("throws NotFoundException if billing account does not exist", async () => {
      prisma.billingAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.pauseAccount("acc-99", "Fraud risk", "admin-1", "admin@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("pauses account and records audit log", async () => {
      const now = new Date();
      prisma.billingAccount.findUnique.mockResolvedValue({
        id: "acc-1",
        status: "active",
        pausedReason: null,
        pausedAt: null,
        ownerUser: { email: "owner@example.com", fullName: "Cairo Owner" },
      });
      prisma.billingAccount.update.mockResolvedValue({
        id: "acc-1",
        status: "paused",
        pausedReason: "Fraud risk",
        pausedAt: now,
      });

      const result = await service.pauseAccount("acc-1", "Fraud risk", "admin-1", "admin@example.com");

      expect(result).toEqual({
        id: "acc-1",
        status: "paused",
        pausedReason: "Fraud risk",
        pausedAt: now,
      });

      expect(prisma.billingAccount.update).toHaveBeenCalledWith({
        where: { id: "acc-1" },
        data: {
          status: "paused",
          pausedReason: "Fraud risk",
          pausedAt: expect.any(Date),
        },
      });

      expect(audit.record).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        actorEmail: "admin@example.com",
        action: "billing.pause",
        targetType: "billing_account",
        targetId: "acc-1",
        reason: "Fraud risk",
        beforeState: {
          status: "active",
          pausedReason: null,
          pausedAt: null,
        },
        afterState: {
          status: "paused",
          pausedReason: "Fraud risk",
          pausedAt: now,
        },
      });
    });
  });

  describe("resumeAccount", () => {
    it("throws NotFoundException if billing account does not exist", async () => {
      prisma.billingAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.resumeAccount("acc-99", "admin-1", "admin@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("resumes account and records audit log", async () => {
      const pausedAt = new Date();
      prisma.billingAccount.findUnique.mockResolvedValue({
        id: "acc-1",
        status: "paused",
        pausedReason: "Resolved investigation",
        pausedAt,
        ownerUser: { email: "owner@example.com", fullName: "Cairo Owner" },
      });
      prisma.billingAccount.update.mockResolvedValue({
        id: "acc-1",
        status: "active",
        pausedReason: null,
        pausedAt: null,
      });

      const result = await service.resumeAccount("acc-1", "admin-1", "admin@example.com");

      expect(result).toEqual({
        id: "acc-1",
        status: "active",
        pausedReason: null,
        pausedAt: null,
      });

      expect(audit.record).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        actorEmail: "admin@example.com",
        action: "billing.resume",
        targetType: "billing_account",
        targetId: "acc-1",
        reason: null,
        beforeState: {
          status: "paused",
          pausedReason: "Resolved investigation",
          pausedAt,
        },
        afterState: {
          status: "active",
          pausedReason: null,
          pausedAt: null,
        },
      });
    });
  });

  describe("listCostAlerts", () => {
    it("flags accounts exceeding EGP 50 monthly cost and high retry count", async () => {
      const periodStart = new Date(Date.UTC(2026, 7, 1));
      prisma.billingProviderCostLedger.findMany.mockResolvedValue([
        {
          billingAccountId: "acc-1",
          billingPeriodStart: periodStart,
          egpCost: 30,
          retryCount: 3,
          billingAccount: {
            ownerUser: { email: "acc1@example.com", fullName: "User One" },
          },
        },
        {
          billingAccountId: "acc-1",
          billingPeriodStart: periodStart,
          egpCost: 30,
          retryCount: 0,
          billingAccount: {
            ownerUser: { email: "acc1@example.com", fullName: "User One" },
          },
        },
        {
          billingAccountId: "acc-2",
          billingPeriodStart: periodStart,
          egpCost: 10,
          retryCount: 0,
          billingAccount: {
            ownerUser: { email: "acc2@example.com", fullName: "User Two" },
          },
        },
      ]);

      const summary = await service.listCostAlerts();

      expect(summary.totalAccountsAboveEgp50).toBe(1);
      expect(summary.totalHighRetryArtifacts).toBe(1);
      expect(summary.alerts.length).toBeGreaterThanOrEqual(1);
      expect(summary.alerts).toContainEqual(
        expect.objectContaining({
          billingAccountId: "acc-1",
          reason: "monthly_cost_exceeded_egp_50",
          totalEgpCost: 60,
        }),
      );
    });
  });

  describe("listReconciliationMismatches", () => {
    it("detects attempts, events, and transactions lacking corresponding links", async () => {
      prisma.billingCheckoutAttempt.findMany.mockResolvedValue([
        {
          id: "attempt-1",
          billingAccountId: "acc-1",
          status: "succeeded",
          confirmedAt: new Date("2026-08-01T00:00:00Z"),
          updatedAt: new Date("2026-08-01T00:00:00Z"),
          providerCheckoutRef: "ref-1",
          transactions: [],
          billingAccount: {
            ownerUser: { email: "user1@example.com" },
          },
        },
      ]);

      prisma.billingProviderEvent.findMany.mockResolvedValue([
        {
          id: "event-1",
          billingAccountId: "acc-2",
          status: "processed",
          processedAt: new Date("2026-08-01T00:00:00Z"),
          receivedAt: new Date("2026-08-01T00:00:00Z"),
          payload: { merchant_reference: "attempt-2" },
          billingAccount: {
            ownerUser: { email: "user2@example.com" },
          },
        },
      ]);
      prisma.billingCheckoutAttempt.findFirst.mockResolvedValue({
        id: "attempt-2",
        providerCheckoutRef: "ref-2",
        transactions: [],
      });

      prisma.billingPaymentTransaction.findMany.mockResolvedValue([
        {
          id: "tx-1",
          billingAccountId: "acc-3",
          checkoutAttemptId: "attempt-3",
          occurredAt: new Date("2026-08-01T00:00:00Z"),
          billingAccount: {
            ownerUser: { email: "user3@example.com" },
            providerEvents: [],
          },
          checkout: {
            id: "attempt-3",
            providerCheckoutRef: "ref-3",
            status: "succeeded",
          },
        },
      ]);

      const mismatches = await service.listReconciliationMismatches();

      expect(mismatches).toHaveLength(3);
      expect(mismatches[0].mismatchType).toBe("succeeded_attempt_no_transaction");
      expect(mismatches[1].mismatchType).toBe("processed_event_no_transaction");
      expect(mismatches[2].mismatchType).toBe("transaction_no_event");
    });
  });

  describe("getAccountById", () => {
    it("returns null if account not found", async () => {
      prisma.billingAccount.findUnique.mockResolvedValue(null);
      expect(await service.getAccountById("acc-99")).toBeNull();
    });

    it("returns summary if found", async () => {
      const createdAt = new Date();
      prisma.billingAccount.findUnique.mockResolvedValue({
        id: "acc-1",
        ownerUserId: "user-1",
        status: "active",
        pausedReason: null,
        pausedAt: null,
        createdAt,
        ownerUser: { email: "user@example.com", fullName: "Test User" },
      });

      const result = await service.getAccountById("acc-1");
      expect(result).toEqual({
        id: "acc-1",
        ownerUserId: "user-1",
        ownerEmail: "user@example.com",
        ownerFullName: "Test User",
        status: "active",
        pausedReason: null,
        pausedAt: null,
        createdAt,
      });
    });
  });

  describe("listAccounts", () => {
    it("returns a paginated list of accounts with owner details", async () => {
      const createdAt = new Date();
      prisma.billingAccount.findMany.mockResolvedValue([
        {
          id: "acc-1",
          ownerUserId: "user-1",
          status: "active",
          pausedReason: null,
          pausedAt: null,
          createdAt,
          ownerUser: { email: "user@example.com", fullName: "Test User" },
        },
        {
          id: "acc-2",
          ownerUserId: "user-2",
          status: "paused",
          pausedReason: "Fraud risk",
          pausedAt: createdAt,
          createdAt,
          ownerUser: { email: "user2@example.com", fullName: null },
        },
      ]);
      prisma.billingAccount.count.mockResolvedValue(2);

      const result = await service.listAccounts({ page: 1, pageSize: 20 });

      expect(result).toEqual({
        items: [
          {
            id: "acc-1",
            ownerUserId: "user-1",
            ownerEmail: "user@example.com",
            ownerFullName: "Test User",
            status: "active",
            pausedReason: null,
            pausedAt: null,
            createdAt,
          },
          {
            id: "acc-2",
            ownerUserId: "user-2",
            ownerEmail: "user2@example.com",
            ownerFullName: null,
            status: "paused",
            pausedReason: "Fraud risk",
            pausedAt: createdAt,
            createdAt,
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });

      expect(prisma.billingAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: "desc" },
          skip: 0,
          take: 20,
          include: {
            ownerUser: { select: { email: true, fullName: true } },
          },
        }),
      );
      expect(prisma.billingAccount.count).toHaveBeenCalledWith({ where: {} });
    });

    it("filters by status and search term", async () => {
      prisma.billingAccount.findMany.mockResolvedValue([]);
      prisma.billingAccount.count.mockResolvedValue(0);

      await service.listAccounts({ page: 2, pageSize: 10, search: "  ali  ", status: "paused" });

      expect(prisma.billingAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: "paused",
            OR: [
              { ownerUser: { email: { contains: "ali", mode: "insensitive" } } },
              { ownerUser: { fullName: { contains: "ali", mode: "insensitive" } } },
            ],
          },
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe("getWalletOverview", () => {
    it("aggregates wallet totals across the platform", async () => {
      prisma.billingAccount.count.mockResolvedValueOnce(5);
      prisma.billingAccount.count.mockResolvedValueOnce(4);
      prisma.billingAccount.count.mockResolvedValueOnce(1);
      prisma.billingPointBalance.aggregate.mockResolvedValue({
        _sum: { balance: 1200, lifetimeGranted: 5000, lifetimeSpent: 3800 },
      });
      prisma.billingPaymentTransaction.aggregate.mockResolvedValue({
        _sum: { amountEgp: 3600 },
        _count: { _all: 12 },
      });

      const overview = await service.getWalletOverview();

      expect(overview).toEqual({
        totalAccounts: 5,
        activeAccounts: 4,
        pausedAccounts: 1,
        totalPointsOutstanding: 1200,
        totalLifetimeGranted: 5000,
        totalLifetimeSpent: 3800,
        totalTopUpEgp: 3600,
        totalTopUpCount: 12,
      });
    });
  });

  describe("topUpWallet", () => {
    it("throws NotFoundException if billing account does not exist", async () => {
      prisma.billingAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.topUpWallet("acc-1", 100, "manual correction", "admin-1", "admin@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException if the wallet has no balance row", async () => {
      prisma.billingAccount.findUnique.mockResolvedValue({
        id: "acc-1",
        pointBalances: [],
      });

      await expect(
        service.topUpWallet("acc-1", 100, "manual correction", "admin-1", "admin@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("credits the wallet and records an audit entry", async () => {
      prisma.billingAccount.findUnique.mockResolvedValue({
        id: "acc-1",
        ownerUser: { email: "user@example.com" },
        pointBalances: [
          { balance: 300, lifetimeGranted: 500, lifetimeSpent: 200 },
        ],
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({
          billingPointBalance: {
            update: prisma.billingPointBalance.update,
          },
          billingPointLedger: {
            create: prisma.billingPointLedger.create,
          },
        });
      });
      prisma.billingPointBalance.update.mockResolvedValue({
        balance: 400,
        lifetimeGranted: 600,
        lifetimeSpent: 200,
      });
      prisma.billingPointLedger.create.mockResolvedValue({ id: "ledger-1" });

      const result = await service.topUpWallet(
        "acc-1",
        100,
        "Operator manual correction",
        "admin-1",
        "admin@example.com",
      );

      expect(result).toEqual({ balance: 400, lifetimeGranted: 600 });
      expect(prisma.billingPointBalance.update).toHaveBeenCalledWith({
        where: { billingAccountId: "acc-1" },
        data: { balance: 400, lifetimeGranted: { increment: 100 } },
      });
      expect(prisma.billingPointLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billingAccountId: "acc-1",
          direction: "credit",
          reason: "topup",
          points: 100,
          balanceAfter: 400,
          transactionId: null,
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "billing.wallet_topup",
          targetType: "billing_account",
          targetId: "acc-1",
          reason: "Operator manual correction",
          beforeState: { balance: 300, lifetimeGranted: 500 },
          afterState: { balance: 400, lifetimeGranted: 600 },
        }),
      );
    });
  });

  describe("listWalletBalances", () => {
    it("returns account rows with point balance and owner details", async () => {
      const createdAt = new Date();
      prisma.billingAccount.findMany.mockResolvedValue([
        {
          id: "acc-1",
          ownerUserId: "user-1",
          status: "active",
          createdAt,
          ownerUser: { email: "user@example.com", fullName: "Test User" },
          pointBalances: [
            {
              balance: 900,
              lifetimeGranted: 2000,
              lifetimeSpent: 1100,
            },
          ],
        },
      ]);
      prisma.billingAccount.count.mockResolvedValue(1);

      const result = await service.listWalletBalances({ page: 1, pageSize: 20 });

      expect(result.items[0]).toMatchObject({
        accountId: "acc-1",
        ownerEmail: "user@example.com",
        ownerFullName: "Test User",
        status: "active",
        balance: 900,
        lifetimeGranted: 2000,
        lifetimeSpent: 1100,
      });
      expect(result.total).toBe(1);
    });

    it("falls back to a zero balance when no balance row exists", async () => {
      prisma.billingAccount.findMany.mockResolvedValue([
        {
          id: "acc-2",
          ownerUserId: "user-2",
          status: "active",
          createdAt: new Date(),
          ownerUser: { email: "user2@example.com", fullName: null },
          pointBalances: [],
        },
      ]);
      prisma.billingAccount.count.mockResolvedValue(1);

      const result = await service.listWalletBalances({ page: 1, pageSize: 20 });

      expect(result.items[0]).toMatchObject({
        accountId: "acc-2",
        balance: 0,
        lifetimeGranted: 0,
        lifetimeSpent: 0,
      });
    });
  });

  describe("getWalletLedger", () => {
    it("returns ledger rows ordered newest first", async () => {
      const createdAt = new Date();
      prisma.billingPointLedger.findMany.mockResolvedValue([
        {
          id: "ledger-1",
          direction: "debit",
          reason: "spend",
          metric: "content_item",
          points: 5,
          balanceAfter: 95,
          claimKey: "claim-1",
          expiresAt: null,
          createdAt,
        },
      ]);

      const rows = await service.getWalletLedger("acc-1");

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        id: "ledger-1",
        direction: "debit",
        reason: "spend",
        metric: "content_item",
        points: 5,
        balanceAfter: 95,
        claimKey: "claim-1",
        expiresAt: null,
        createdAt,
      });
      expect(prisma.billingPointLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { billingAccountId: "acc-1" },
          orderBy: { createdAt: "desc" },
        }),
      );
    });
  });

  describe("listWalletTransactions", () => {
    it("returns payment transactions with owner details", async () => {
      const occurredAt = new Date();
      prisma.billingPaymentTransaction.findMany.mockResolvedValue([
        {
          id: "tx-1",
          billingAccountId: "acc-1",
          provider: "fake",
          providerTransactionId: "pt-1",
          kind: "topup",
          status: "succeeded",
          amountEgp: 300,
          currency: "EGP",
          paymentMode: "card",
          occurredAt,
          billingAccount: {
            ownerUser: { email: "user@example.com", fullName: "Test User" },
          },
        },
      ]);
      prisma.billingPaymentTransaction.count.mockResolvedValue(1);

      const result = await service.listWalletTransactions({ page: 1, pageSize: 20 });

      expect(result.items[0]).toMatchObject({
        id: "tx-1",
        accountId: "acc-1",
        ownerEmail: "user@example.com",
        ownerFullName: "Test User",
        provider: "fake",
        kind: "topup",
        status: "succeeded",
        amountEgp: 300,
        currency: "EGP",
        paymentMode: "card",
        occurredAt,
      });
      expect(result.total).toBe(1);
    });
  });
});
