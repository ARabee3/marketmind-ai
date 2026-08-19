import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/persistence/prisma.service";
import { FakePaymentProvider } from "./fake-payment.provider";
import { BillingService } from "./billing.service";

type Tx = {
  $queryRaw: jest.Mock;
  billingPointLedger: {
    findUnique: jest.Mock;
    findFirst?: jest.Mock;
    create: jest.Mock;
  };
  billingPointBalance: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

describe("BillingService points ledger", () => {
  function makeService(tx: Tx) {
    const prisma = {
      billingAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: "account-1" }),
      },
      billingPointLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (t: Tx) => unknown) =>
        callback(tx),
      ),
    };
    const fake = new FakePaymentProvider(
      new ConfigService({ billing: { fakeWebhookSecret: "test-secret" } }),
    );
    return new BillingService(
      prisma as unknown as PrismaService,
      fake,
      new ConfigService({ app: { nodeEnv: "test" } }),
      fake,
    );
  }

  function baseTx(overrides: Partial<Tx> = {}): Tx {
    return {
      $queryRaw: jest.fn().mockResolvedValue([]),
      billingPointLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      billingPointBalance: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "balance-1", balance: 65 }),
        update: jest.fn().mockResolvedValue({}),
      },
      ...overrides,
    };
  }

  it("debits points and writes a spend ledger row", async () => {
    const tx = baseTx();
    const service = makeService(tx);

    await service.spendPoints("user-1", "content_item", 3, "content-pack:p1");

    expect(tx.billingPointBalance.update).toHaveBeenCalledWith({
      where: { billingAccountId: "account-1" },
      data: { balance: 59, lifetimeSpent: { increment: 6 } },
    });
    expect(tx.billingPointLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billingAccountId: "account-1",
        direction: "debit",
        reason: "spend",
        metric: "content_item",
        points: 6,
        balanceAfter: 59,
        claimKey: "content-pack:p1",
      }),
    });
  });

  it("is a no-op when the same claim key is replayed", async () => {
    const tx = baseTx({
      billingPointLedger: {
        findUnique: jest.fn().mockResolvedValue({
          id: "ledger-1",
          claimKey: "content-pack:p1",
        }),
        create: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(tx);

    await service.spendPoints("user-1", "content_item", 3, "content-pack:p1");

    expect(tx.billingPointBalance.update).not.toHaveBeenCalled();
    expect(tx.billingPointLedger.create).not.toHaveBeenCalled();
  });

  it("blocks a spend that exceeds the balance", async () => {
    const tx = baseTx({
      billingPointBalance: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "balance-1", balance: 3 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = makeService(tx);

    await expect(
      service.spendPoints("user-1", "content_item", 3, "content-pack:p1"),
    ).rejects.toMatchObject({ code: "BILLING_INSUFFICIENT_POINTS" });

    expect(tx.billingPointBalance.update).not.toHaveBeenCalled();
    expect(tx.billingPointLedger.create).not.toHaveBeenCalled();
  });

  it("refunds a spend exactly once by claim key", async () => {
    const refunded = new Set<string>();
    const tx = baseTx({
      billingPointLedger: {
        findUnique: jest.fn(
          ({ where }: { where: { billingAccountId_claimKey: { claimKey: string } } }) => {
            const key = where.billingAccountId_claimKey.claimKey;
            if (key === "spend-1") {
              return {
                id: "ledger-1",
                direction: "debit",
                metric: "strategy_cycle",
                points: 50,
              };
            }
            return refunded.has(key)
              ? { id: "ledger-2", direction: "credit" }
              : null;
          },
        ),
        create: jest.fn().mockImplementation(({ data }: { data: { claimKey: string } }) => {
          refunded.add(data.claimKey);
          return {};
        }),
      },
    });
    const service = makeService(tx);

    await service.refundPoints("user-1", "spend-1");

    expect(tx.billingPointBalance.update).toHaveBeenCalledWith({
      where: { billingAccountId: "account-1" },
      data: { balance: 115 },
    });
    expect(tx.billingPointLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "credit",
        reason: "refund",
        metric: "strategy_cycle",
        points: 50,
        balanceAfter: 115,
        claimKey: "refund:spend-1",
      }),
    });

    await service.refundPoints("user-1", "spend-1");
    expect(tx.billingPointLedger.create).toHaveBeenCalledTimes(1);
  });

  it("refunds the latest strategy-cycle spend for a deleted strategy", async () => {
    const tx = baseTx({
      billingPointLedger: {
        findUnique: jest.fn(({ where }: { where: { billingAccountId_claimKey: { claimKey: string } } }) =>
          where.billingAccountId_claimKey.claimKey === "strategy-cycle:strat-1:run-9"
            ? {
                id: "ledger-1",
                direction: "debit",
                metric: "strategy_cycle",
                points: 50,
              }
            : null,
        ),
        findFirst: jest.fn().mockResolvedValue({
          id: "ledger-1",
          claimKey: "strategy-cycle:strat-1:run-9",
        }),
        create: jest.fn().mockResolvedValue({}),
      },
    });
    const prisma = {
      billingAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: "account-1" }),
      },
      billingPointLedger: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ledger-1",
          claimKey: "strategy-cycle:strat-1:run-9",
        }),
      },
      $transaction: jest.fn(async (callback: (t: Tx) => unknown) =>
        callback(tx),
      ),
    };
    const fake = new FakePaymentProvider(
      new ConfigService({ billing: { fakeWebhookSecret: "test-secret" } }),
    );
    const service = new BillingService(
      prisma as unknown as PrismaService,
      fake,
      new ConfigService({ app: { nodeEnv: "test" } }),
      fake,
    );

    await service.releaseStrategyCycle("user-1", "strat-1");

    expect(tx.billingPointLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimKey: "refund:strategy-cycle:strat-1:run-9",
        balanceAfter: 115,
      }),
    });
  });
});
