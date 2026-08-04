import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { BillingPaymentMode } from "@marketmind/contracts";
import {
  PaymentProviderPort,
  BillingProviderPayloadError,
  BillingProviderSignatureError,
  type CreateProviderCheckoutInput,
  type PaymentProviderEvent,
  type ProviderCheckoutResult,
  type ProviderWebhookInput,
} from "./payment-provider.port";

export const FAKE_PAYMENT_PROVIDER = "fake";

type FakeWebhookPayload = {
  readonly event_id: string;
  readonly event_type: "checkout.paid" | "checkout.failed" | "checkout.pending";
  readonly checkout_ref: string;
  readonly transaction_ref: string;
  readonly amount_egp: number;
  readonly currency: "EGP";
  readonly payment_mode: BillingPaymentMode;
  readonly occurred_at: string;
};

/**
 * Deterministic sandbox adapter used until Paymob or Geidea completes the
 * merchant procurement gate. It deliberately exposes sandbox=true so the Web
 * app cannot present a simulated payment as a live settlement.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProviderPort {
  readonly name = FAKE_PAYMENT_PROVIDER;

  private readonly webhookSecret: string;
  private readonly webOrigin: string;

  constructor(config: ConfigService) {
    this.webhookSecret =
      config.get<string>("billing.fakeWebhookSecret") ??
      "marketmind-development-billing-webhook";
    this.webOrigin = config.get<string>("cors.origin") ?? "http://localhost:3000";
  }

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderCheckoutResult> {
    const checkoutRef = `fake_checkout_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    return {
      provider: this.name,
      checkoutRef,
      checkoutUrl: `${this.webOrigin}/billing/sandbox/${checkoutRef}`,
      status: "pending",
      expiresAt,
      sandbox: true,
    };
  }

  verifyAndParseWebhook(input: ProviderWebhookInput): PaymentProviderEvent {
    const payload = parsePayload(input.body);
    const canonicalBody = input.rawBody ?? Buffer.from(JSON.stringify(payload));
    const expected = createHmac("sha256", this.webhookSecret)
      .update(canonicalBody)
      .digest("hex");
    const signatureValid = Boolean(
      input.signature && safeEqual(input.signature, expected),
    );

    if (!signatureValid) {
      throw new BillingProviderSignatureError();
    }

    const fingerprint = createHash("sha256")
      .update(canonicalBody)
      .digest("hex");

    return {
      provider: this.name,
      externalEventId: payload.event_id,
      fingerprint,
      eventType: payload.event_type,
      checkoutRef: payload.checkout_ref,
      transactionRef: payload.transaction_ref,
      amountEgp: payload.amount_egp,
      currency: payload.currency,
      paymentMode: payload.payment_mode,
      signatureValid,
      payload: payload as unknown as Readonly<Record<string, unknown>>,
      occurredAt: new Date(payload.occurred_at),
    };
  }

  async cancelRecurringAgreement(_agreementRef: string): Promise<void> {
    return;
  }

  async refund(_transactionRef: string, _amountEgp: number): Promise<void> {
    return;
  }

  /** Test/demo helper. The caller still has to send this payload through the
   * webhook controller so signature verification and idempotency are tested.
   */
  signWebhook(payload: FakeWebhookPayload): string {
    return createHmac("sha256", this.webhookSecret)
      .update(JSON.stringify(payload))
      .digest("hex");
  }

  createWebhookPayload(
    input: Omit<FakeWebhookPayload, "event_id" | "occurred_at"> & {
      readonly event_id?: string;
      readonly occurred_at?: string;
    },
  ): FakeWebhookPayload {
    return {
      ...input,
      event_id: input.event_id ?? randomUUID(),
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    };
  }
}

function parsePayload(value: unknown): FakeWebhookPayload {
  if (!isRecord(value)) {
    throw new BillingProviderPayloadError();
  }

  const eventType = value.event_type;
  const paymentMode = value.payment_mode;
  if (
    typeof value.event_id !== "string" ||
    !["checkout.paid", "checkout.failed", "checkout.pending"].includes(
      String(eventType),
    ) ||
    typeof value.checkout_ref !== "string" ||
    typeof value.transaction_ref !== "string" ||
    typeof value.amount_egp !== "number" ||
    !Number.isSafeInteger(value.amount_egp) ||
    value.amount_egp < 0 ||
    value.currency !== "EGP" ||
    !["recurring_card", "one_time_card", "wallet", "reference"].includes(
      String(paymentMode),
    ) ||
    typeof value.occurred_at !== "string" ||
    Number.isNaN(new Date(value.occurred_at).getTime())
  ) {
    throw new BillingProviderPayloadError();
  }

  return {
    event_id: value.event_id,
    event_type: eventType as FakeWebhookPayload["event_type"],
    checkout_ref: value.checkout_ref,
    transaction_ref: value.transaction_ref,
    amount_egp: value.amount_egp,
    currency: "EGP",
    payment_mode: paymentMode as BillingPaymentMode,
    occurred_at: value.occurred_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
