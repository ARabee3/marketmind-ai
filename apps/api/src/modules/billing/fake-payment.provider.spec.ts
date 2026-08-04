import { ConfigService } from "@nestjs/config";
import { FakePaymentProvider } from "./fake-payment.provider";

function provider(): FakePaymentProvider {
  return new FakePaymentProvider(
    new ConfigService({
      billing: { fakeWebhookSecret: "test-secret" },
      cors: { origin: "http://localhost:3000" },
    }),
  );
}

describe("FakePaymentProvider", () => {
  it("creates an explicitly sandbox hosted checkout", async () => {
    const result = await provider().createCheckout({
      amountEgp: 299,
      currency: "EGP",
      paymentMode: "one_time_card",
      merchantReference: "attempt-1",
      idempotencyKey: "checkout-idempotency-1",
      metadata: {},
    });

    expect(result.provider).toBe("fake");
    expect(result.sandbox).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.checkoutUrl).toContain("/billing/sandbox/");
  });

  it("verifies signed events and rejects invalid signatures", () => {
    const fake = provider();
    const payload = fake.createWebhookPayload({
      event_type: "checkout.paid",
      checkout_ref: "fake_checkout_1",
      transaction_ref: "fake_transaction_1",
      amount_egp: 299,
      currency: "EGP",
      payment_mode: "one_time_card",
    });
    const rawBody = Buffer.from(JSON.stringify(payload));

    const event = fake.verifyAndParseWebhook({
      body: payload,
      rawBody,
      signature: fake.signWebhook(payload),
    });

    expect(event.eventType).toBe("checkout.paid");
    expect(event.amountEgp).toBe(299);
    expect(event.signatureValid).toBe(true);
    expect(() =>
      fake.verifyAndParseWebhook({
        body: payload,
        rawBody,
        signature: "invalid",
      }),
    ).toThrow("signature is invalid");
  });
});
