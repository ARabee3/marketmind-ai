import { Injectable } from "@nestjs/common";
import { pointsForMetric, type BillingMetric } from "@marketmind/contracts";
import {
  BillingDomainException,
  BillingService,
  type ProviderCostRecord,
} from "./billing.service";

export type BillingEntitlementDecision = {
  readonly allowed: boolean;
  readonly state: string;
  readonly metric: BillingMetric;
  readonly requested: number;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly reason:
    | "active"
    | "trial"
    | "past_due_grace"
    | "expired"
    | "limit"
    | "cost_circuit";
};

/**
 * Server-side entitlement boundary for expensive or externally visible work.
 * Consumers call this at request time and again when a queued worker starts.
 * The interface is unchanged; the internals decide against the prepaid points
 * balance instead of artifact-count quotas. Customer point spending is
 * intentionally separate from provider-cost telemetry; this service only
 * decides whether the artifact is allowed and charges it on success.
 */
@Injectable()
export class BillingEntitlementsService {
  constructor(private readonly billingService: BillingService) {}

  async check(
    userId: string,
    metric: BillingMetric,
    requested = 1,
  ): Promise<BillingEntitlementDecision> {
    const wallet = await this.billingService.getWallet(userId);
    const cost = pointsForMetric(metric, requested);
    const remaining = Math.max(0, wallet.balance - cost);

    const circuitOpen = await this.billingService.isProviderCostCircuitBreakerOpen(
      userId,
    );
    if (circuitOpen) {
      return {
        allowed: false,
        state: "cost_circuit",
        metric,
        requested,
        used: 0,
        limit: wallet.balance,
        remaining,
        reason: "cost_circuit",
      };
    }

    const allowed = wallet.balance >= cost;

    return {
      allowed,
      state: allowed ? "active" : "expired",
      metric,
      requested,
      used: 0,
      limit: wallet.balance,
      remaining,
      reason: allowed ? "active" : "limit",
    };
  }

  async assertAllowed(
    userId: string,
    metric: BillingMetric,
    requested = 1,
  ): Promise<BillingEntitlementDecision> {
    const decision = await this.check(userId, metric, requested);
    if (!decision.allowed) {
      if (decision.reason === "cost_circuit") {
        throw new BillingDomainException(
          "BILLING_COST_CIRCUIT_OPEN",
          "Monthly provider cost limit reached. New AI work is paused until the billing period resets.",
        );
      }
      throw new BillingDomainException(
        "BILLING_INSUFFICIENT_POINTS",
        "Not enough points for this action. Top up to continue.",
      );
    }
    return decision;
  }

  async record(
    userId: string,
    metric: BillingMetric,
    units: number,
    claimKey: string,
    _businessId?: string,
  ): Promise<void> {
    await this.billingService.spendPoints(userId, metric, units, claimKey);
  }

  /**
   * Records provider-cost telemetry for a provider-backed run so margins are
   * measured against the published point menu.
   */
  async recordProviderCost(
    ownerUserId: string,
    input: ProviderCostRecord,
  ): Promise<void> {
    await this.billingService.recordProviderCost(ownerUserId, input);
  }

  /**
   * Reverses a points debit by claim key (used when the strategy phase fails
   * after its reserve was taken).
   */
  async refund(userId: string, claimKey: string): Promise<void> {
    await this.billingService.refundPoints(userId, claimKey);
  }

  /**
   * Refunds the strategy-phase reserve for a strategy cycle that was deleted
   * (owner rejection wipes the whole cycle), so the owner can start over
   * without being blocked by points that no longer represent real work.
   */
  async releaseStrategyCycle(
    userId: string,
    strategyId: string,
  ): Promise<void> {
    await this.billingService.releaseStrategyCycle(userId, strategyId);
  }
}
