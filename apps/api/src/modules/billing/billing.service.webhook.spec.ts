import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/persistence/prisma.service";
import { FakePaymentProvider } from "./fake-payment.provider";
import { PaymobPaymentProvider } from "./paymob-payment.provider";
import { BillingService } from "./billing.service";

describe("BillingService webhook recovery", () => {
  it("reprocesses a previously failed event instead of treating it as done", async () => {
    const fake = new FakePaymentProvider(
      new ConfigService({
        billing: { fakeWebhookSecret: "test-secret" },
      }),
    );
    const payload = fake.createWebhookPayload({
      event_type: "checkout.failed",
      checkout_ref: "attempt-1",
      transaction_ref: "transaction-1",
      amount_egp: 299,
      currency: "EGP",
      payment_mode: "one_time_card",
      event_id: "event-1",
    });
    const rawBody = Buffer.from(JSON.stringify(payload));
    const event = fake.verifyAndParseWebhook({
      body: payload,
      rawBody,
      signature: fake.signWebhook(payload),
    });
    const eventUpdate = jest.fn().mockResolvedValue({});
    const checkoutUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      billingProviderEvent: {
        findUnique: jest.fn().mockResolvedValue({
          provider: "fake",
          externalEventId: event.externalEventId,
          fingerprint: event.fingerprint,
          status: "failed",
        }),
        update: eventUpdate,
      },
      billingCheckoutAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: "attempt-id",
          billingAccountId: "account-id",
          amountEgp: 299,
          currency: "EGP",
          price: { code: "growth_300" },
        }),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ billingCheckoutAttempt: { update: checkoutUpdate } }),
      ),
    };
    const service = new BillingService(
      prisma as unknown as PrismaService,
      fake,
      new ConfigService({ app: { nodeEnv: "test" } }),
      fake,
    );

    await expect(
      service.handleWebhook("fake", payload, rawBody, fake.signWebhook(payload)),
    ).resolves.toEqual({ accepted: true, duplicate: true });

    expect(eventUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { status: "received", processedAt: null },
      }),
    );
    expect(checkoutUpdate).toHaveBeenCalledWith({
      where: { id: "attempt-id" },
      data: { status: "failed" },
    });
    expect(eventUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { status: "processed", processedAt: expect.any(Date) },
      }),
    );
  });

  it("credits bundle points exactly once on a verified paid event", async () => {
    const fake = new FakePaymentProvider(
      new ConfigService({ billing: { fakeWebhookSecret: "test-secret" } }),
    );
    const payload = fake.createWebhookPayload({
      event_type: "checkout.paid",
      checkout_ref: "attempt-1",
      transaction_ref: "transaction-1",
      amount_egp: 100,
      currency: "EGP",
      payment_mode: "one_time_card",
      event_id: "event-2",
    });
    const rawBody = Buffer.from(JSON.stringify(payload));
    let processed = false;
    const event = fake.verifyAndParseWebhook({
      body: payload,
      rawBody,
      signature: fake.signWebhook(payload),
    });
    const transactionCreate = jest.fn().mockResolvedValue({ id: "tx-1" });
    const balanceUpdate = jest.fn().mockResolvedValue({});
    const ledgerCreate = jest.fn().mockResolvedValue({});
    const outboxCreate = jest.fn().mockResolvedValue({});
    const checkoutUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      billingPaymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: transactionCreate,
      },
      billingCheckoutAttempt: { update: checkoutUpdate },
      billingPointBalance: {
        findUnique: jest.fn().mockResolvedValue({
          id: "balance-1",
          balance: 65,
        }),
        update: balanceUpdate,
      },
      billingPointLedger: { create: ledgerCreate },
      billingOutbox: { create: outboxCreate },
    };
    const prisma = {
      billingProviderEvent: {
        findUnique: jest.fn().mockImplementation(() =>
          processed
            ? {
                provider: "fake",
                externalEventId: event.externalEventId,
                fingerprint: event.fingerprint,
                status: "processed",
              }
            : null,
        ),
        create: jest.fn().mockImplementation(() => {
          processed = true;
          return {};
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      billingCheckoutAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: "attempt-id",
          billingAccountId: "account-id",
          amountEgp: 100,
          currency: "EGP",
          price: { code: "starter_150" },
        }),
      },
      $transaction: jest.fn(async (callback: (t: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const service = new BillingService(
      prisma as unknown as PrismaService,
      fake,
      new ConfigService({ app: { nodeEnv: "test" } }),
      fake,
    );

    await service.handleWebhook("fake", payload, rawBody, fake.signWebhook(payload));
    await service.handleWebhook("fake", payload, rawBody, fake.signWebhook(payload));

    expect(transactionCreate).toHaveBeenCalledTimes(1);
    expect(balanceUpdate).toHaveBeenCalledWith({
      where: { billingAccountId: "account-id" },
      data: { balance: 215, lifetimeGranted: { increment: 150 } },
    });
    expect(ledgerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billingAccountId: "account-id",
        direction: "credit",
        reason: "topup",
        points: 150,
        balanceAfter: 215,
        claimKey: "topup:transaction-1",
      }),
    });
    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });

  it("confirms a Paymob checkout as paid in dev and never double-credits", async () => {
    const attemptState: { status: string } = { status: "pending" };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      billingPaymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "tx-1" }),
      },
      billingCheckoutAttempt: {
        update: jest.fn().mockImplementation(() => {
          attemptState.status = "succeeded";
          return Promise.resolve({});
        }),
      },
      billingPointBalance: {
        findUnique: jest.fn().mockResolvedValue({ id: "balance-1", balance: 65 }),
        update: jest.fn().mockResolvedValue({}),
      },
      billingPointLedger: { create: jest.fn().mockResolvedValue({}) },
      billingOutbox: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      billingCheckoutAttempt: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "attempt-id",
            billingAccountId: "account-id",
            amountEgp: 100,
            currency: "EGP",
            status: attemptState.status,
            price: { code: "starter_150" },
          }),
        ),
      },
      billingAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: "account-id" }),
      },
      billingProviderEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const paymobConfig = {
      app: { nodeEnv: "test" },
      cors: { origin: "http://localhost:3000" },
      billing: {
        paymob: {
          baseUrl: "https://accept.paymob.com",
          secretKey: "secret",
          publicKey: "pk_test_123",
          integrationIds: [5634162],
          hmacSecret: "hmac-secret",
          timeoutMs: 1000,
          sandbox: true,
        },
      },
    };
    const paymob = new PaymobPaymentProvider(new ConfigService(paymobConfig));
    const fake = new FakePaymentProvider(
      new ConfigService({ billing: { fakeWebhookSecret: "test-secret" } }),
    );
    const service = new BillingService(
      prisma as unknown as PrismaService,
      paymob,
      new ConfigService(paymobConfig),
      fake,
    );

    const first = await service.confirmSandboxCheckout("user-1", "attempt-1", "paid");
    expect(first).toEqual({ accepted: true, duplicate: false });
    expect(tx.billingPointBalance.update).toHaveBeenCalledWith({
      where: { billingAccountId: "account-id" },
      data: { balance: 215, lifetimeGranted: { increment: 150 } },
    });
    expect(tx.billingPointLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "credit",
        reason: "topup",
        points: 150,
        claimKey: expect.stringMatching(/^topup:\d+$/),
      }),
    });

    const second = await service.confirmSandboxCheckout("user-1", "attempt-1", "paid");
    expect(second).toEqual({ accepted: true, duplicate: true });
    expect(tx.billingPointLedger.create).toHaveBeenCalledTimes(1);
  });
});
