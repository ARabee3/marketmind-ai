import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/persistence/prisma.service";
import { FakePaymentProvider } from "./fake-payment.provider";
import { BillingService } from "./billing.service";

describe("BillingService usage release", () => {
  function makeService(deleteMany: jest.Mock) {
    const prisma = {
      billingUsageLedger: { deleteMany },
      billingAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: "account-1" }),
        create: jest.fn(),
      },
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

  it("releases strategy-cycle and strategy-revision ledger rows for the deleted strategy", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = makeService(deleteMany);

    await service.releaseUsageForStrategy("user-1", "strat-1");

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        billingAccountId: "account-1",
        OR: [
          { claimKey: { startsWith: "strategy-cycle:strat-1:" } },
          { claimKey: { startsWith: "strategy-revision:strat-1:" } },
        ],
      },
    });
  });
});
