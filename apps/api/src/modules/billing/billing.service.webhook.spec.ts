import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/persistence/prisma.service";
import { FakePaymentProvider } from "./fake-payment.provider";
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
          price: { periodDays: 30 },
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
});
