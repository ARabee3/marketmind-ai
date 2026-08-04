import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/persistence/prisma.service";
import { FakePaymentProvider } from "./fake-payment.provider";
import { BillingService } from "./billing.service";

describe("BillingService catalog", () => {
  it("returns only the public Egypt launch catalog", () => {
    const fake = new FakePaymentProvider(new ConfigService());
    const service = new BillingService(
      {} as PrismaService,
      fake,
      new ConfigService(),
      fake,
    );

    const catalog = service.getPrices();
    expect(catalog.currency).toBe("EGP");
    expect(catalog.prices.map((price) => price.code)).toEqual([
      "trial_14d_v1",
      "growth_monthly_v1",
      "growth_yearly_v1",
    ]);
    expect(catalog.prices.some((price) => price.amount_egp === 999)).toBe(false);
  });

  it("rejects the private founding pilot price through the checkout API", async () => {
    const fake = new FakePaymentProvider(new ConfigService());
    const service = new BillingService(
      {} as PrismaService,
      fake,
      new ConfigService(),
      fake,
    );

    await expect(
      service.createCheckout("owner-1", {
        price_code: "growth_founding_monthly_v1",
        payment_mode: "one_time_card",
        idempotency_key: "private-pilot-key-1234",
      }),
    ).rejects.toMatchObject({ code: "BILLING_PRICE_NOT_PUBLIC" });
  });
});
