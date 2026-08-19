import type { BillingPaymentMode } from "@marketmind/contracts";

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export type ProviderCheckoutStatus = "pending" | "succeeded" | "failed";

/**
 * Customer billing data forwarded to the payment provider. Paymob's Intention
 * API requires these fields to be present (non-empty) to create an intention;
 * they are the merchant-side customer record. The hosted checkout collects the
 * cardholder's payment details separately.
 */
export type ProviderBillingData = {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly apartment: string;
  readonly building: string;
  readonly floor: string;
  readonly street: string;
  readonly city: string;
  readonly country: string;
  readonly state: string;
  readonly postalCode: string;
};

export type CreateProviderCheckoutInput = {
  readonly amountEgp: number;
  readonly currency: "EGP";
  readonly paymentMode: BillingPaymentMode;
  readonly merchantReference: string;
  readonly idempotencyKey: string;
  readonly billingData: ProviderBillingData;
  readonly metadata: Readonly<Record<string, string>>;
};

export type ProviderCheckoutResult = {
  readonly provider: string;
  readonly checkoutRef: string;
  readonly checkoutUrl: string;
  readonly status: ProviderCheckoutStatus;
  readonly expiresAt: Date;
  readonly sandbox: boolean;
};

export type ProviderWebhookInput = {
  readonly body: unknown;
  readonly rawBody?: Buffer;
  readonly signature?: string;
};

export type ProviderPaymentEvent = {
  readonly provider: string;
  readonly externalEventId: string;
  readonly fingerprint: string;
  readonly eventType: "checkout.paid" | "checkout.failed" | "checkout.pending";
  readonly checkoutRef: string;
  readonly transactionRef: string;
  readonly amountEgp: number;
  readonly currency: "EGP";
  readonly paymentMode: BillingPaymentMode;
  readonly signatureValid: boolean;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
};

export type PaymentProviderEvent = ProviderPaymentEvent;

export type PaymentProviderPort = {
  readonly name: string;
  createCheckout(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutResult>;
  verifyAndParseWebhook(input: ProviderWebhookInput): ProviderPaymentEvent;
  cancelRecurringAgreement(agreementRef: string): Promise<void>;
  refund(transactionRef: string, amountEgp: number): Promise<void>;
};

export class BillingProviderSignatureError extends Error {
  readonly code = "BILLING_PROVIDER_SIGNATURE_INVALID" as const;

  constructor() {
    super("Billing provider webhook signature is invalid.");
    this.name = "BillingProviderSignatureError";
  }
}

export class BillingProviderPayloadError extends Error {
  readonly code = "BILLING_PROVIDER_UNAVAILABLE" as const;

  constructor() {
    super("Billing provider webhook payload is invalid.");
    this.name = "BillingProviderPayloadError";
  }
}
