import { Injectable } from "@nestjs/common";
import type { BillingMetric } from "@marketmind/contracts";
import { BillingDomainException, BillingService } from "./billing.service";

export type BillingEntitlementDecision = {
  readonly allowed: boolean;
  readonly state: string;
  readonly metric: BillingMetric;
  readonly requested: number;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly reason: "active" | "trial" | "past_due_grace" | "expired" | "limit";
};

/**
 * Server-side entitlement boundary for expensive or externally visible work.
 * Consumers call this at request time and again when a queued worker starts.
 * Customer artifact usage is intentionally separate from provider-cost
 * telemetry; this service only decides whether the artifact is allowed.
 */
@Injectable()
export class BillingEntitlementsService {
  constructor(private readonly billingService: BillingService) {}

  async check(
    userId: string,
    metric: BillingMetric,
    requested = 1,
  ): Promise<BillingEntitlementDecision> {
    const subscription = await this.billingService.getSubscription(userId);
    const usage = await this.billingService.getUsage(userId);
    const current = usage.metrics.find((item) => item.metric === metric);
    const used = current?.used ?? 0;
    const limit = current?.limit ?? 0;
    const remaining = Math.max(0, limit - used);
    const state = subscription.state;
    const accessState = [
      "trialing",
      "active",
      "past_due",
      "cancel_at_period_end",
    ].includes(state);
    const allowed = accessState && remaining >= requested;

    return {
      allowed,
      state,
      metric,
      requested,
      used,
      limit,
      remaining,
      reason: !accessState
        ? "expired"
        : state === "trialing"
          ? "trial"
          : state === "past_due"
            ? "past_due_grace"
            : allowed
              ? "active"
              : "limit",
    };
  }

  async assertAllowed(
    userId: string,
    metric: BillingMetric,
    requested = 1,
  ): Promise<BillingEntitlementDecision> {
    const decision = await this.check(userId, metric, requested);
    if (!decision.allowed) {
      throw new BillingDomainException(
        decision.reason === "expired"
          ? "BILLING_TRIAL_EXPIRED"
          : "BILLING_ENTITLEMENT_EXHAUSTED",
        decision.reason === "expired"
          ? "Billing access has expired. Renew to start new AI work."
          : "This plan limit has been reached for the current period.",
      );
    }
    return decision;
  }

  async record(
    userId: string,
    metric: BillingMetric,
    units: number,
    claimKey: string,
    businessId?: string,
  ): Promise<void> {
    await this.billingService.recordUsage(
      userId,
      metric,
      units,
      claimKey,
      businessId,
    );
  }
}
