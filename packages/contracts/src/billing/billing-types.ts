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

export type BillingBundleCode = "starter_150" | "growth_300" | "pro_500";

export type BillingPointBundle = {
  readonly code: BillingBundleCode;
  readonly points: number;
  readonly amount_egp: number;
  readonly currency: "EGP";
  readonly display_name_en: string;
  readonly display_name_ar: string;
};

/**
 * The prepaid points bundle catalog. Server-controlled and versioned: the
 * browser only ever sends a bundle code, and the API resolves the exact EGP
 * amount and granted points from this list. Never reprice a bundle code in
 * place — add a new code and retire the old one so already-granted points
 * keep their purchase semantics.
 */
export const BILLING_BUNDLES: readonly BillingPointBundle[] = [
  {
    code: "starter_150",
    points: 150,
    amount_egp: 100,
    currency: "EGP",
    display_name_en: "Starter",
    display_name_ar: "مبتدئ",
  },
  {
    code: "growth_300",
    points: 300,
    amount_egp: 200,
    currency: "EGP",
    display_name_en: "Growth",
    display_name_ar: "نمو",
  },
  {
    code: "pro_500",
    points: 500,
    amount_egp: 300,
    currency: "EGP",
    display_name_en: "Pro",
    display_name_ar: "احترافي",
  },
] as const;

/**
 * Fixed, published point price per owner action. Charged on the successful
 * artifact only — failed/retried provider attempts never spend points.
 * Versioned alongside the bundle catalog; do not change a price in place once
 * it has been granted/published.
 */
export const POINT_PRICES: Readonly<Record<BillingMetric, number>> = {
  content_item: 2,
  content_revision: 1,
  static_image: 8,
  strategy_cycle: 50,
  strategy_revision: 10,
  discovery: 0,
  publication_target: 0,
};

export const TRIAL_GRANT_POINTS = 65;

/** Balance below which the owner sees a low-balance nudge. */
export const LOW_BALANCE_THRESHOLD_POINTS = 20;

export function pointsForMetric(metric: BillingMetric, units = 1): number {
  return POINT_PRICES[metric] * Math.max(0, units);
}

export function getBillingBundle(
  code: string,
): BillingPointBundle | undefined {
  return BILLING_BUNDLES.find((bundle) => bundle.code === code);
}

export type BillingBundlesResponse = {
  readonly version: "billing-bundles-v1";
  readonly currency: "EGP";
  readonly bundles: readonly BillingPointBundle[];
};

export type BillingWalletResponse = {
  readonly billing_account_id: string;
  readonly balance: number;
  readonly lifetime_granted: number;
  readonly lifetime_spent: number;
  readonly low_balance: boolean;
};

export type BillingPointLedgerEntry = {
  readonly id: string;
  readonly direction: "credit" | "debit";
  readonly reason: "topup" | "trial_grant" | "spend" | "refund";
  readonly metric: BillingMetric | null;
  readonly points: number;
  readonly balance_after: number;
  readonly created_at: string;
};

export type BillingPointLedgerResponse = {
  readonly entries: readonly BillingPointLedgerEntry[];
};

export type BillingCheckoutRequest = {
  readonly bundle_code: BillingBundleCode;
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
  | "BILLING_TRIAL_EXPIRED"
  | "BILLING_BUNDLE_NOT_FOUND"
  | "BILLING_INSUFFICIENT_POINTS";

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
