import { ConfigService } from "@nestjs/config";
import { PaymobPaymentProvider, createPaymobTestHmac } from "./paymob-payment.provider";

const transaction = {
  amount: 29900,
  created_at: "2026-08-04T20:00:00.000Z",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  id: 12345,
  integration_id: 987,
  is_3d_secure: true,
  is_auth: true,
  is_capture: true,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 55, merchant_order_id: "attempt-1" },
  owner: 246,
  pending: false,
  source_data_pan: "2346",
  source_data_sub_type: "MasterCard",
  source_data_type: "card",
  success: true,
};

function provider(): PaymobPaymentProvider {
  return new PaymobPaymentProvider(
    new ConfigService({
      billing: {
        paymob: {
          baseUrl: "https://accept.paymob.com",
          secretKey: "secret",
          publicKey: "pk_test_123",
          integrationIds: [987],
          hmacSecret: "hmac-secret",
          timeoutMs: 1000,
          sandbox: true,
        },
      },
    }),
  );
}

describe("PaymobPaymentProvider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates a server-priced Unified Checkout intention", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "pi_1", client_secret: "cs_1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await provider().createCheckout({
      amountEgp: 299,
      currency: "EGP",
      paymentMode: "one_time_card",
      merchantReference: "attempt-1",
      idempotencyKey: "checkout-idempotency-1",
      billingData: {
        firstName: "MarketMind",
        lastName: "Customer",
        email: "billing@example.com",
        phone: "01000000000",
        apartment: "1",
        building: "1",
        floor: "1",
        street: "N/A",
        city: "Cairo",
        country: "EG",
        state: "Cairo",
        postalCode: "11511",
      },
      metadata: {
        billing_account_id: "account-1",
        price_code: "growth_monthly_v1",
      },
    });

    expect(result.provider).toBe("paymob");
    expect(result.sandbox).toBe(true);
    expect(result.checkoutRef).toBe("attempt-1");
    expect(result.checkoutUrl).toBe(
      "https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test_123&clientSecret=cs_1",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://accept.paymob.com/v1/intention/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Token secret" }),
        body: expect.stringContaining('"amount":29900'),
      }),
    );
    const body = JSON.parse(
      String(fetchMock.mock.calls[0][1].body),
    );
    expect(body.redirect_url).toBe("http://localhost:3000/billing");
    expect(body.payment_methods).toEqual([987]);
    expect(body.billing_data.email).toBe("billing@example.com");
  });

  it("maps a signed Paymob transaction callback to the provider-neutral event", () => {
    const hmac = createPaymobTestHmac(transaction, "hmac-secret");
    const event = provider().verifyAndParseWebhook({
      body: { type: "TRANSACTION", obj: transaction, hmac },
      signature: hmac,
      rawBody: Buffer.from("raw-paymob-body"),
    });

    expect(event).toEqual(
      expect.objectContaining({
        provider: "paymob",
        eventType: "checkout.paid",
        checkoutRef: "attempt-1",
        transactionRef: "12345",
        amountEgp: 299,
        currency: "EGP",
        paymentMode: "one_time_card",
        signatureValid: true,
      }),
    );
  });

  it("rejects a callback with an invalid HMAC", () => {
    expect(() =>
      provider().verifyAndParseWebhook({
        body: { type: "TRANSACTION", obj: transaction },
        signature: "invalid",
      }),
    ).toThrow("signature is invalid");
  });
});
