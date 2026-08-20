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
      findMany: jest.Mock;
      count: jest.Mock;
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
        findMany: jest.fn(),
        count: jest.fn(),
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
