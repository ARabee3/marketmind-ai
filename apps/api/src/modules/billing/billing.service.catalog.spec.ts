import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/persistence/prisma.service";
import { FakePaymentProvider } from "./fake-payment.provider";
import { BillingService } from "./billing.service";

describe("BillingService bundles", () => {
  function makeService() {
    const fake = new FakePaymentProvider(new ConfigService());
    return new BillingService(
      {} as PrismaService,
      fake,
      new ConfigService(),
      fake,
    );
  }

  it("returns exactly the reviewed Egypt bundle catalog", () => {
    const bundles = makeService().getBundles();
    expect(bundles.currency).toBe("EGP");
    expect(bundles.bundles.map((bundle) => bundle.code)).toEqual([
      "starter_150",
      "growth_300",
      "pro_500",
    ]);
    expect(bundles.bundles.map((bundle) => bundle.points)).toEqual([
      150, 300, 500,
    ]);
  });

  it("rejects an unknown bundle code through the checkout API", async () => {
    await expect(
      makeService().createCheckout("owner-1", {
        bundle_code: "phantom_999" as never,
        payment_mode: "one_time_card",
        idempotency_key: "unknown-bundle-key-123",
      }),
    ).rejects.toMatchObject({ code: "BILLING_BUNDLE_NOT_FOUND" });
  });

  it("rejects recurring-card payment for a one-time points top-up", async () => {
    await expect(
      makeService().createCheckout("owner-1", {
        bundle_code: "growth_300",
        payment_mode: "recurring_card",
        idempotency_key: "recurring-rejected-key-1",
      }),
    ).rejects.toMatchObject({ code: "BILLING_PROVIDER_UNAVAILABLE" });
  });
});
