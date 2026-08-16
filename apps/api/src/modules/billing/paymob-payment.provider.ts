import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { BillingPaymentMode } from "@marketmind/contracts";
import {
  BillingProviderPayloadError,
  BillingProviderSignatureError,
  PaymentProviderPort,
  type CreateProviderCheckoutInput,
  type PaymentProviderEvent,
  type ProviderCheckoutResult,
  type ProviderWebhookInput,
} from "./payment-provider.port";

export const PAYMOB_PAYMENT_PROVIDER = "paymob";

/**
 * The 20 transaction fields Paymob includes in webhook HMAC validation,
 * sorted lexicographically by field name (verified against real callbacks:
 * `is_refund` is NOT part of the HMAC, `success` IS the final field). The
 * canonical string concatenates the field values in this order (no
 * separators), hashed with HMAC-SHA512 and the merchant HMAC secret. Note
 * `error_occured` (one "r") is Paymob's own spelling and `order.id` /
 * `source_data.*` are nested values.
 */
const PAYMOB_HMAC_FIELDS: ReadonlyArray<{
  readonly name: string;
  readonly value: (transaction: Record<string, unknown>) => unknown;
}> = [
  { name: "amount_cents", value: (t) => t.amount_cents },
  { name: "created_at", value: (t) => t.created_at },
  { name: "currency", value: (t) => t.currency },
  { name: "error_occured", value: (t) => t.error_occured },
  { name: "has_parent_transaction", value: (t) => t.has_parent_transaction },
  { name: "id", value: (t) => t.id },
  { name: "integration_id", value: (t) => t.integration_id },
  { name: "is_3d_secure", value: (t) => t.is_3d_secure },
  { name: "is_auth", value: (t) => t.is_auth },
  { name: "is_capture", value: (t) => t.is_capture },
  { name: "is_refunded", value: (t) => t.is_refunded },
  { name: "is_standalone_payment", value: (t) => t.is_standalone_payment },
  { name: "is_voided", value: (t) => t.is_voided },
  {
    name: "order.id",
    value: (t) =>
      t.order && typeof t.order === "object"
        ? (t.order as Record<string, unknown>).id
        : undefined,
  },
  { name: "owner", value: (t) => t.owner },
  { name: "pending", value: (t) => t.pending },
  {
    name: "source_data.pan",
    value: (t) =>
      t.source_data && typeof t.source_data === "object"
        ? (t.source_data as Record<string, unknown>).pan
        : undefined,
  },
  {
    name: "source_data.sub_type",
    value: (t) =>
      t.source_data && typeof t.source_data === "object"
        ? (t.source_data as Record<string, unknown>).sub_type
        : undefined,
  },
  {
    name: "source_data.type",
    value: (t) =>
      t.source_data && typeof t.source_data === "object"
        ? (t.source_data as Record<string, unknown>).type
        : undefined,
  },
  { name: "success", value: (t) => t.success },
];

type PaymobConfig = {
  readonly baseUrl: string;
  readonly secretKey: string;
  readonly publicKey: string;
  readonly integrationIds: readonly number[];
  readonly hmacSecret: string;
  readonly timeoutMs: number;
  readonly sandbox: boolean;
  readonly webOrigin: string;
};

type PaymobTransactionPayload = {
  readonly type?: unknown;
  readonly hmac?: unknown;
  readonly obj?: Record<string, unknown>;
};

/**
 * Paymob's current hosted flow is backend-first: create an intention with the
 * secret key, then redirect the owner to Unified Checkout with the returned
 * client secret. The adapter intentionally has no fallback to the legacy
 * iframe flow; the merchant's enabled integration IDs decide which local
 * methods (cards, wallets, kiosk/reference) appear in hosted checkout.
 */
@Injectable()
export class PaymobPaymentProvider implements PaymentProviderPort {
  readonly name = PAYMOB_PAYMENT_PROVIDER;

  private readonly config: PaymobConfig;

  constructor(configService: ConfigService) {
    const configuredIds = configService.get<unknown[]>("billing.paymob.integrationIds") ?? [];
    this.config = {
      baseUrl: trimTrailingSlash(
        configService.get<string>("billing.paymob.baseUrl") ??
          "https://accept.paymob.com",
      ),
      secretKey: configService.get<string>("billing.paymob.secretKey") ?? "",
      publicKey: configService.get<string>("billing.paymob.publicKey") ?? "",
      integrationIds: configuredIds
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0),
      hmacSecret: configService.get<string>("billing.paymob.hmacSecret") ?? "",
      timeoutMs:
        configService.get<number>("billing.paymob.timeoutMs") ?? 15000,
      sandbox: configService.get<boolean>("billing.paymob.sandbox") ?? false,
      webOrigin:
        configService.get<string>("cors.origin") ?? "http://localhost:3000",
    };
  }

  async createCheckout(
    input: CreateProviderCheckoutInput,
  ): Promise<ProviderCheckoutResult> {
    this.assertConfigured();
    if (input.paymentMode === "recurring_card") {
      throw new Error(
        "Paymob recurring checkout is gated until the merchant-approved Subscriptions Module contract is configured.",
      );
    }
    if (!Number.isSafeInteger(input.amountEgp) || input.amountEgp <= 0) {
      throw new Error("Paymob requires a positive whole-EGP amount.");
    }

    const amountMinor = input.amountEgp * 100;
    const response = await this.request<PaymobIntentionResponse>(
      "/v1/intention/",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${this.config.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountMinor,
          currency: input.currency,
          payment_methods: this.config.integrationIds,
          special_reference: input.merchantReference,
          // The hosted checkout returns the owner to the billing page after
          // payment; the web proxy negotiates the locale from the cookie. The
          // points themselves are granted by the verified webhook.
          redirect_url: `${this.config.webOrigin}/billing`,
          billing_data: {
            first_name: input.billingData.firstName,
            last_name: input.billingData.lastName,
            email: input.billingData.email,
            phone_number: input.billingData.phone,
            apartment: input.billingData.apartment,
            building: input.billingData.building,
            floor: input.billingData.floor,
            street: input.billingData.street,
            city: input.billingData.city,
            country: input.billingData.country,
            state: input.billingData.state,
            postal_code: input.billingData.postalCode,
          },
          items: [
            {
              name: "MarketMind Growth",
              amount: amountMinor,
              description: "MarketMind AI subscription",
              quantity: 1,
            },
          ],
          extras: {
            marketmind_billing_account_id: input.metadata.billing_account_id,
            marketmind_bundle_code: input.metadata.bundle_code,
            marketmind_idempotency_key: input.idempotencyKey,
          },
        }),
      },
    );

    if (!response.client_secret) {
      throw new Error("Paymob intention response did not include client_secret.");
    }

    return {
      provider: this.name,
      // The merchant reference is the stable value echoed in Paymob's order
      // callback. The intention id remains provider data in the URL/response.
      checkoutRef: input.merchantReference,
      checkoutUrl: `${this.config.baseUrl}/unifiedcheckout/?publicKey=${encodeURIComponent(this.config.publicKey)}&clientSecret=${encodeURIComponent(response.client_secret)}`,
      status: "pending",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      sandbox: this.config.sandbox,
    };
  }

  verifyAndParseWebhook(input: ProviderWebhookInput): PaymentProviderEvent {
    const payload = parsePaymobPayload(input.body);
    const transaction = payload.obj;
    const receivedHmac =
      input.signature ?? (typeof payload.hmac === "string" ? payload.hmac : "");

    if (!this.config.hmacSecret || !verifyPaymobHmac(transaction, receivedHmac, this.config.hmacSecret)) {
      throw new BillingProviderSignatureError();
    }

    const amountMinor = readInteger(transaction.amount_cents, "amount_cents");
    const amountEgp = amountMinor / 100;
    const currency = readString(transaction.currency, "currency").toUpperCase();
    if (currency !== "EGP" || !Number.isSafeInteger(amountEgp)) {
      throw new BillingProviderPayloadError();
    }

    const checkoutRef = readMerchantReference(transaction.order);
    const transactionRef = String(transaction.id);
    const eventType = transaction.pending === true
      ? "checkout.pending"
      : transaction.success === true
        ? "checkout.paid"
        : "checkout.failed";
    const occurredAt = new Date(readString(transaction.created_at, "created_at"));
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BillingProviderPayloadError();
    }

    const raw = input.rawBody ?? Buffer.from(JSON.stringify(input.body));
    return {
      provider: this.name,
      externalEventId: `${String(payload.type ?? "TRANSACTION").toUpperCase()}:${transactionRef}`,
      fingerprint: createHash("sha256").update(raw).digest("hex"),
      eventType,
      checkoutRef,
      transactionRef,
      amountEgp,
      currency: "EGP",
      paymentMode: paymentModeFromSource(transaction.source_data),
      signatureValid: true,
      payload: input.body as Readonly<Record<string, unknown>>,
      occurredAt,
    };
  }

  async cancelRecurringAgreement(_agreementRef: string): Promise<void> {
    throw new Error("Paymob recurring agreement cancellation needs merchant-approved subscription credentials.");
  }

  async refund(_transactionRef: string, _amountEgp: number): Promise<void> {
    throw new Error("Paymob refunds require the approved merchant refund operation.");
  }

  private assertConfigured(): void {
    if (
      !this.config.secretKey ||
      !this.config.publicKey ||
      !this.config.hmacSecret ||
      this.config.integrationIds.length === 0
    ) {
      throw new Error(
        "Paymob is not configured. Set PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_INTEGRATION_IDS, and PAYMOB_HMAC_SECRET after merchant approval.",
      );
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const body = await response.text();
      let parsed: unknown = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        // Surface Paymob's error detail (field errors, rate-limit info) so a
        // 503 on checkout is diagnosable from logs. The response body contains
        // request field echoes, never credentials.
        const detail =
          parsed && typeof parsed === "object"
            ? `: ${JSON.stringify(parsed).slice(0, 300)}`
            : "";
        throw new Error(
          `Paymob intention request failed with HTTP ${response.status}${detail}.`,
        );
      }
      if (!isRecord(parsed)) {
        throw new Error("Paymob intention response was not JSON.");
      }
      return parsed as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type PaymobIntentionResponse = {
  readonly id?: string | number;
  readonly client_secret?: string;
};

export function verifyPaymobHmac(
  transaction: Record<string, unknown>,
  receivedHmac: string,
  secret: string,
): boolean {
  if (!receivedHmac || !secret) return false;
  const canonical = PAYMOB_HMAC_FIELDS.map((field) =>
    hmacValue(field.value(transaction)),
  ).join("");
  const expected = createHmac("sha512", secret).update(canonical).digest("hex");
  const left = Buffer.from(receivedHmac, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePaymobPayload(value: unknown): PaymobTransactionPayload & {
  readonly obj: Record<string, unknown>;
} {
  if (!isRecord(value) || !isRecord(value.obj)) {
    throw new BillingProviderPayloadError();
  }
  if (value.type !== undefined && typeof value.type !== "string") {
    throw new BillingProviderPayloadError();
  }
  return {
    type: value.type,
    hmac: value.hmac,
    obj: value.obj,
  };
}

function readMerchantReference(value: unknown): string {
  if (!isRecord(value)) throw new BillingProviderPayloadError();
  const reference = value.merchant_order_id ?? value.id;
  if (typeof reference !== "string" && typeof reference !== "number") {
    throw new BillingProviderPayloadError();
  }
  return String(reference);
}

function readInteger(value: unknown, _field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BillingProviderPayloadError();
  }
  return value;
}

function readString(value: unknown, _field: string): string {
  if (typeof value !== "string" || !value) {
    throw new BillingProviderPayloadError();
  }
  return value;
}

function paymentModeFromSource(value: unknown): BillingPaymentMode {
  if (!isRecord(value)) return "one_time_card";
  const sourceType = String(value.type ?? "").toLowerCase();
  if (sourceType.includes("wallet")) return "wallet";
  if (sourceType.includes("cash") || sourceType.includes("kiosk")) {
    return "reference";
  }
  return "one_time_card";
}

function hmacValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isRecord(value) && value.id !== undefined) return String(value.id);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

// Keep a local helper available to tests and runbooks without exposing secrets.
export function createPaymobTestHmac(
  transaction: Record<string, unknown>,
  secret: string,
): string {
  const canonical = PAYMOB_HMAC_FIELDS.map((field) =>
    hmacValue(field.value(transaction)),
  ).join("");
  return createHmac("sha512", secret).update(canonical).digest("hex");
}
