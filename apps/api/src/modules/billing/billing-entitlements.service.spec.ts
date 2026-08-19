import { BillingService } from "./billing.service";
import { BillingEntitlementsService } from "./billing-entitlements.service";

describe("BillingEntitlementsService", () => {
  function makeBillingService(overrides: {
    balance?: number;
    circuitOpen?: boolean;
  } = {}) {
    const { balance = 500, circuitOpen = false } = overrides;
    return {
      getWallet: jest.fn().mockResolvedValue({
        billing_account_id: "account-1",
        balance,
        lifetime_granted: 500,
        lifetime_spent: 0,
        low_balance: false,
      }),
      isProviderCostCircuitBreakerOpen: jest
        .fn()
        .mockResolvedValue(circuitOpen),
      spendPoints: jest.fn(),
      refundPoints: jest.fn(),
      recordProviderCost: jest.fn(),
      releaseStrategyCycle: jest.fn(),
    } as unknown as BillingService;
  }

  it("allows work within the points balance when the circuit is closed", async () => {
    const billing = makeBillingService();
    const service = new BillingEntitlementsService(billing);

    const decision = await service.check("user-1", "content_item");

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("active");
  });

  it("denies work with a cost_circuit reason when the breaker is open", async () => {
    const billing = makeBillingService({ circuitOpen: true });
    const service = new BillingEntitlementsService(billing);

    const decision = await service.check("user-1", "content_item");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cost_circuit");
    expect(decision.state).toBe("cost_circuit");
  });

  it("assertAllowed throws BILLING_COST_CIRCUIT_OPEN when the breaker is open", async () => {
    const billing = makeBillingService({ circuitOpen: true });
    const service = new BillingEntitlementsService(billing);

    await expect(
      service.assertAllowed("user-1", "content_item"),
    ).rejects.toMatchObject({ code: "BILLING_COST_CIRCUIT_OPEN" });
  });

  it("assertAllowed throws BILLING_INSUFFICIENT_POINTS when balance is short and the circuit is closed", async () => {
    const billing = makeBillingService({ balance: 0 });
    const service = new BillingEntitlementsService(billing);

    await expect(
      service.assertAllowed("user-1", "content_item"),
    ).rejects.toMatchObject({ code: "BILLING_INSUFFICIENT_POINTS" });
  });

  it("allows work when the breaker is open but the owner has no recorded cost", async () => {
    const billing = makeBillingService({ circuitOpen: false });
    const service = new BillingEntitlementsService(billing);

    await expect(service.assertAllowed("user-1", "content_item")).resolves.toMatchObject(
      { allowed: true },
    );
  });
});