export type BillingPlanCode = "trial" | "growth";

export type BillingPriceInterval =
  | "trial"
  | "monthly"
  | "yearly"
  | "founding_pilot";

export type BillingPriceCode =
  | "trial_14d_v1"
  | "growth_monthly_v1"
  | "growth_yearly_v1"
  | "growth_founding_monthly_v1";

export type BillingSubscriptionState =
  | "trialing"
  | "checkout_pending"
  | "active"
  | "past_due"
  | "paused"
  | "cancel_at_period_end"
  | "expired"
  | "refunded";

export type BillingRenewalMode = "none" | "recurring_card" | "manual";

export type BillingPaymentMode =
  | "recurring_card"
  | "one_time_card"
  | "wallet"
  | "reference";

export type BillingCheckoutStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "expired";

export type BillingTransactionStatus = "pending" | "succeeded" | "failed";

export type BillingTransactionKind = "charge" | "refund" | "chargeback";

export type BillingMetric =
  | "discovery"
  | "strategy_cycle"
  | "strategy_revision"
  | "content_item"
  | "content_revision"
  | "static_image"
  | "publication_target";

export type BillingEntitlements = {
  readonly business_count: number;
  readonly strategy_cycles: number;
  readonly strategy_revisions_per_cycle: number;
  readonly content_items_rolling_30d: number;
  readonly static_images_per_period: number;
  readonly content_revisions_per_item: number;
  readonly connected_targets: number;
};

export type BillingCatalogPrice = {
  readonly code: BillingPriceCode;
  readonly plan_code: BillingPlanCode;
  readonly interval: BillingPriceInterval;
  readonly amount_egp: number;
  readonly currency: "EGP";
  readonly period_days: number;
  readonly public: boolean;
  readonly display_name_en: string;
  readonly display_name_ar: string;
  readonly entitlements: BillingEntitlements;
};

const TRIAL_ENTITLEMENTS: BillingEntitlements = {
  business_count: 1,
  strategy_cycles: 1,
  strategy_revisions_per_cycle: 0,
  content_items_rolling_30d: 3,
  static_images_per_period: 1,
  content_revisions_per_item: 1,
  connected_targets: 0,
};

const GROWTH_ENTITLEMENTS: BillingEntitlements = {
  business_count: 1,
  strategy_cycles: 1,
  strategy_revisions_per_cycle: 1,
  content_items_rolling_30d: 20,
  static_images_per_period: 12,
  content_revisions_per_item: 2,
  connected_targets: 2,
};

/**
 * The launch catalog is deliberately small. Prices are server-controlled and
 * the API persists the selected version before creating a provider checkout.
 */
export const BILLING_CATALOG: readonly BillingCatalogPrice[] = [
  {
    code: "trial_14d_v1",
    plan_code: "trial",
    interval: "trial",
    amount_egp: 0,
    currency: "EGP",
    period_days: 14,
    public: true,
    display_name_en: "Trial",
    display_name_ar: "تجربة",
    entitlements: TRIAL_ENTITLEMENTS,
  },
  {
    code: "growth_monthly_v1",
    plan_code: "growth",
    interval: "monthly",
    amount_egp: 299,
    currency: "EGP",
    period_days: 30,
    public: true,
    display_name_en: "Growth",
    display_name_ar: "نمو",
    entitlements: GROWTH_ENTITLEMENTS,
  },
  {
    code: "growth_yearly_v1",
    plan_code: "growth",
    interval: "yearly",
    amount_egp: 2990,
    currency: "EGP",
    period_days: 365,
    public: true,
    display_name_en: "Growth yearly",
    display_name_ar: "نمو سنوي",
    entitlements: GROWTH_ENTITLEMENTS,
  },
  {
    code: "growth_founding_monthly_v1",
    plan_code: "growth",
    interval: "founding_pilot",
    amount_egp: 249,
    currency: "EGP",
    period_days: 30,
    public: false,
    display_name_en: "Growth founding pilot",
    display_name_ar: "نمو — برنامج التأسيس",
    entitlements: GROWTH_ENTITLEMENTS,
  },
] as const;

export type BillingCatalogResponse = {
  readonly version: "billing-v1";
  readonly currency: "EGP";
  readonly prices: readonly BillingCatalogPrice[];
};

export type BillingCheckoutRequest = {
  readonly price_code: BillingPriceCode;
  readonly payment_mode: BillingPaymentMode;
  readonly idempotency_key: string;
};

export type BillingCheckoutResponse = {
  readonly checkout_attempt_id: string;
  readonly status: BillingCheckoutStatus;
  readonly checkout_url: string;
  readonly provider: string;
  readonly provider_checkout_ref: string;
  readonly amount_egp: number;
  readonly currency: "EGP";
  readonly expires_at: string;
  readonly sandbox: boolean;
};

export type BillingSubscriptionResponse = {
  readonly billing_account_id: string;
  readonly state: BillingSubscriptionState;
  readonly plan_code: BillingPlanCode;
  readonly price_code: BillingPriceCode;
  readonly amount_egp: number;
  readonly currency: "EGP";
  readonly renewal_mode: BillingRenewalMode;
  readonly paid_through_at: string | null;
  readonly grace_ends_at: string | null;
  readonly trial_ends_at: string | null;
  readonly cancel_at_period_end: boolean;
  readonly payment_provider: string | null;
  readonly masked_payment_method: string | null;
};

export type BillingUsageMetric = {
  readonly metric: BillingMetric;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly period_start: string;
  readonly period_end: string;
};

export type BillingUsageResponse = {
  readonly state: BillingSubscriptionState;
  readonly plan_code: BillingPlanCode;
  readonly metrics: readonly BillingUsageMetric[];
};

export type BillingTransactionResponse = {
  readonly id: string;
  readonly kind: BillingTransactionKind;
  readonly status: BillingTransactionStatus;
  readonly amount_egp: number;
  readonly currency: "EGP";
  readonly provider: string;
  readonly payment_mode: BillingPaymentMode | null;
  readonly occurred_at: string;
};

export type BillingTransactionsResponse = {
  readonly transactions: readonly BillingTransactionResponse[];
};

export type BillingErrorCode =
  | "BILLING_PRICE_NOT_FOUND"
  | "BILLING_PRICE_NOT_PUBLIC"
  | "BILLING_IDEMPOTENCY_CONFLICT"
  | "BILLING_CHECKOUT_NOT_FOUND"
  | "BILLING_CHECKOUT_EXPIRED"
  | "BILLING_PROVIDER_UNAVAILABLE"
  | "BILLING_PROVIDER_SIGNATURE_INVALID"
  | "BILLING_PROVIDER_EVENT_DUPLICATE"
  | "BILLING_AMOUNT_MISMATCH"
  | "BILLING_SUBSCRIPTION_NOT_ACTIVE"
  | "BILLING_ENTITLEMENT_EXHAUSTED"
  | "BILLING_TRIAL_EXPIRED";

export function getPublicBillingCatalog(): BillingCatalogResponse {
  return {
    version: "billing-v1",
    currency: "EGP",
    prices: BILLING_CATALOG.filter((price) => price.public),
  };

}

export function getBillingPrice(
  code: string,
): BillingCatalogPrice | undefined {
  return BILLING_CATALOG.find((price) => price.code === code);
}

export function billingLimitForMetric(
  entitlements: BillingEntitlements,
  metric: BillingMetric,
): number {
  switch (metric) {
    case "discovery":
      return entitlements.strategy_cycles > 0 ? 1 : 0;
    case "strategy_revision":
      return entitlements.strategy_revisions_per_cycle;
    case "strategy_cycle":
      return entitlements.strategy_cycles;
    case "content_item":
      return entitlements.content_items_rolling_30d;
    case "content_revision":
      return entitlements.content_revisions_per_item;
    case "static_image":
      return entitlements.static_images_per_period;
    case "publication_target":
      return entitlements.connected_targets;
  }
}
