import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  BILLING_CATALOG,
  billingLimitForMetric,
  getBillingPrice,
  getPublicBillingCatalog,
  type BillingCatalogPrice,
  type BillingCheckoutRequest,
  type BillingCheckoutResponse,
  type BillingMetric,
  type BillingPaymentMode,
  type BillingSubscriptionResponse,
  type BillingTransactionResponse,
  type BillingTransactionsResponse,
  type BillingUsageResponse,
} from "@marketmind/contracts";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  FakePaymentProvider,
} from "./fake-payment.provider";
import { ConfigService } from "@nestjs/config";
import {
  PAYMENT_PROVIDER,
  BillingProviderPayloadError,
  BillingProviderSignatureError,
  type PaymentProviderEvent,
  type PaymentProviderPort,
} from "./payment-provider.port";

type SubscriptionWithPrice = Prisma.BillingSubscriptionGetPayload<{
  include: { price: true };
}>;

type CheckoutWithPrice = Prisma.BillingCheckoutAttemptGetPayload<{
  include: { price: true };
}>;

type TransactionRecord = Prisma.BillingPaymentTransactionGetPayload<{
  select: {
    id: true;
    kind: true;
    status: true;
    amountEgp: true;
    currency: true;
    provider: true;
    paymentMode: true;
    occurredAt: true;
  };
}>;

export type BillingWebhookResult = {
  readonly accepted: true;
  readonly duplicate: boolean;
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
    private readonly config: ConfigService,
    private readonly fakePaymentProvider: FakePaymentProvider,
  ) {}

  getPrices() {
    return getPublicBillingCatalog();
  }

  async getSubscription(userId: string): Promise<BillingSubscriptionResponse> {
    const account = await this.ensureBillingAccount(userId);
    let subscription = await this.findLatestSubscription(account.id);

    if (!subscription) {
      throw new InternalServerErrorException("Billing trial could not be created");
    }

    const refreshedState = await this.refreshStateIfExpired(subscription);
    subscription = refreshedState.subscription;
    return toSubscriptionResponse(account.id, subscription);
  }

  async getUsage(userId: string): Promise<BillingUsageResponse> {
    const account = await this.ensureBillingAccount(userId);
    const subscription = await this.findLatestSubscription(account.id);
    if (!subscription) {
      throw new InternalServerErrorException("Billing trial could not be created");
    }

    const refreshed = await this.refreshStateIfExpired(subscription);
    const price = refreshed.subscription.price;
    const { periodStart, periodEnd } = usagePeriod(refreshed.subscription);
    const rows = await this.prisma.billingUsageLedger.findMany({
      where: {
        billingAccountId: account.id,
        periodStart,
        periodEnd,
      },
    });

    const metrics: BillingMetric[] = [
      "discovery",
      "strategy_cycle",
      "strategy_revision",
      "content_item",
      "content_revision",
      "static_image",
      "publication_target",
    ];

    return {
      state: refreshed.subscription.state as BillingUsageResponse["state"],
      plan_code: price.planCode as BillingUsageResponse["plan_code"],
      metrics: metrics.map((metric) => {
        const used = rows
          .filter((row) => row.metric === metric)
          .reduce((total, row) => total + row.units, 0);
        const limit = billingLimitForMetric(
          price.entitlements as BillingCatalogPrice["entitlements"],
          metric,
        );
        return {
          metric,
          used,
          limit,
          remaining: Math.max(0, limit - used),
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        };
      }),
    };
  }

  /**
   * Records a successful, customer-visible artifact against an idempotent
   * logical claim. The account row is locked for the short transaction so two
   * workers cannot both spend the same remaining entitlement. A replay of the
   * same claim key is a no-op.
   */
  async recordUsage(
    userId: string,
    metric: BillingMetric,
    units: number,
    claimKey: string,
    businessId?: string,
  ): Promise<void> {
    if (!Number.isSafeInteger(units) || units <= 0) {
      throw new BillingDomainException(
        "BILLING_ENTITLEMENT_EXHAUSTED",
        "Usage units must be a positive whole number.",
      );
    }

    const account = await this.ensureBillingAccount(userId);
    const subscription = await this.findLatestSubscription(account.id);
    if (!subscription) {
      throw new InternalServerErrorException("Billing subscription is missing");
    }
    const refreshed = await this.refreshStateIfExpired(subscription);
    if (!isAccessState(refreshed.subscription.state)) {
      throw new BillingDomainException(
        refreshed.subscription.state === "expired"
          ? "BILLING_TRIAL_EXPIRED"
          : "BILLING_ENTITLEMENT_EXHAUSTED",
        "Billing access is not active for new work.",
      );
    }

    const { periodStart, periodEnd } = usagePeriod(refreshed.subscription);
    const entitlements = refreshed.subscription.price.entitlements as BillingCatalogPrice["entitlements"];
    const limit = billingLimitForMetric(entitlements, metric);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "billing_accounts"
        WHERE "id" = ${account.id}::uuid
        FOR UPDATE
      `;

      const existing = await tx.billingUsageLedger.findUnique({
        where: {
          billingAccountId_metric_periodStart_claimKey: {
            billingAccountId: account.id,
            metric,
            periodStart,
            claimKey,
          },
        },
      });
      if (existing) return;

      const aggregate = await tx.billingUsageLedger.aggregate({
        where: {
          billingAccountId: account.id,
          metric,
          periodStart,
          periodEnd,
        },
        _sum: { units: true },
      });
      const used = aggregate._sum.units ?? 0;
      if (used + units > limit) {
        throw new BillingDomainException(
          "BILLING_ENTITLEMENT_EXHAUSTED",
          "This plan limit has been reached for the current period.",
        );
      }

      await tx.billingUsageLedger.create({
        data: {
          id: randomUUID(),
          billingAccountId: account.id,
          businessId,
          metric,
          periodStart,
          periodEnd,
          units,
          claimKey,
        },
      });
    });
  }

  async getTransactions(
    userId: string,
  ): Promise<BillingTransactionsResponse> {
    const account = await this.ensureBillingAccount(userId);
    const transactions = await this.prisma.billingPaymentTransaction.findMany({
      where: { billingAccountId: account.id },
      orderBy: { occurredAt: "desc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        status: true,
        amountEgp: true,
        currency: true,
        provider: true,
        paymentMode: true,
        occurredAt: true,
      },
    });

    return {
      transactions: transactions.map(toTransactionResponse),
    };
  }

  async createCheckout(
    userId: string,
    input: BillingCheckoutRequest,
  ): Promise<BillingCheckoutResponse> {
    const price = getBillingPrice(input.price_code);
    if (!price || price.interval === "trial") {
      throw new BillingDomainException(
        "BILLING_PRICE_NOT_FOUND",
        "That billing price is not available.",
      );
    }
    if (!price.public) {
      throw new BillingDomainException(
        "BILLING_PRICE_NOT_PUBLIC",
        "That billing price is reserved for an approved pilot cohort.",
      );
    }

    if (
      input.payment_mode === "recurring_card" &&
      !["monthly", "yearly"].includes(price.interval)
    ) {
      throw new BillingDomainException(
        "BILLING_PROVIDER_UNAVAILABLE",
        "Recurring card renewal is not available for this price.",
      );
    }

    const account = await this.ensureBillingAccount(userId);
    const storedPrice = await this.ensurePrice(price);
    const requestFingerprint = fingerprintCheckout(input, price);
    const existing = await this.findCheckoutByIdempotency(
      account.id,
      input.idempotency_key,
    );

    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new BillingDomainException(
          "BILLING_IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for a different checkout.",
        );
      }
      return toCheckoutResponse(existing);
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    let attempt: CheckoutWithPrice;

    try {
      attempt = await this.prisma.billingCheckoutAttempt.create({
        data: {
          id: randomUUID(),
          billingAccountId: account.id,
          priceId: storedPrice.id,
          idempotencyKey: input.idempotency_key,
          requestFingerprint,
          provider: this.paymentProvider.name,
          amountEgp: price.amount_egp,
          currency: price.currency,
          paymentMode: input.payment_mode,
          sandbox: false,
          status: "pending",
          expiresAt,
        },
        include: { price: true },
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const replay = await this.findCheckoutByIdempotency(
          account.id,
          input.idempotency_key,
        );
        if (replay && replay.requestFingerprint === requestFingerprint) {
          return toCheckoutResponse(replay);
        }
        throw new BillingDomainException(
          "BILLING_IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for a different checkout.",
        );
      }
      throw error;
    }

    try {
      const providerCheckout = await this.paymentProvider.createCheckout({
        amountEgp: price.amount_egp,
        currency: price.currency,
        paymentMode: input.payment_mode,
        merchantReference: attempt.id,
        idempotencyKey: input.idempotency_key,
        metadata: {
          billing_account_id: account.id,
          price_code: price.code,
        },
      });

      const updated = await this.prisma.billingCheckoutAttempt.update({
        where: { id: attempt.id },
        data: {
          providerCheckoutRef: providerCheckout.checkoutRef,
          providerCheckoutUrl: providerCheckout.checkoutUrl,
          expiresAt: providerCheckout.expiresAt,
          sandbox: providerCheckout.sandbox,
          status: providerCheckout.status,
        },
        include: { price: true },
      });
      return toCheckoutResponse(updated);
    } catch (error) {
      await this.prisma.billingCheckoutAttempt.update({
        where: { id: attempt.id },
        data: { status: "failed" },
      });
      throw new ServiceUnavailableException(
        "The payment provider is temporarily unavailable.",
      );
    }
  }

  async cancelSubscription(userId: string): Promise<BillingSubscriptionResponse> {
    const account = await this.ensureBillingAccount(userId);
    const subscription = await this.findLatestSubscription(account.id);
    if (!subscription || !isAccessState(subscription.state)) {
      throw new BillingDomainException(
        "BILLING_SUBSCRIPTION_NOT_ACTIVE",
        "There is no active subscription to cancel.",
      );
    }

    if (subscription.providerAgreementRef) {
      await this.paymentProvider.cancelRecurringAgreement(
        subscription.providerAgreementRef,
      );
    }

    const updated = await this.prisma.billingSubscription.update({
      where: { id: subscription.id },
      data: {
        state: "cancel_at_period_end",
        cancelAtPeriodEnd: true,
        cancelRequestedAt: new Date(),
      },
      include: { price: true },
    });
    return toSubscriptionResponse(account.id, updated);
  }

  async resumeSubscription(userId: string): Promise<BillingSubscriptionResponse> {
    const account = await this.ensureBillingAccount(userId);
    const subscription = await this.findLatestSubscription(account.id);
    if (!subscription || subscription.state !== "cancel_at_period_end") {
      throw new BillingDomainException(
        "BILLING_SUBSCRIPTION_NOT_ACTIVE",
        "There is no pending cancellation to resume.",
      );
    }

    const updated = await this.prisma.billingSubscription.update({
      where: { id: subscription.id },
      data: {
        state: "active",
        cancelAtPeriodEnd: false,
        cancelRequestedAt: null,
      },
      include: { price: true },
    });
    return toSubscriptionResponse(account.id, updated);
  }

  async handleWebhook(
    providerName: string,
    body: unknown,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<BillingWebhookResult> {
    if (providerName !== this.paymentProvider.name) {
      throw new BillingDomainException(
        "BILLING_PROVIDER_UNAVAILABLE",
        "This payment provider is not enabled.",
      );
    }

    let event: PaymentProviderEvent;
    try {
      event = this.paymentProvider.verifyAndParseWebhook({
        body,
        rawBody,
        signature,
      });
    } catch (error) {
      if (error instanceof BillingProviderSignatureError) {
        throw new UnauthorizedException({
          code: error.code,
          message: error.message,
        });
      }
      if (error instanceof BillingProviderPayloadError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    const existingEvent = await this.prisma.billingProviderEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: event.provider,
          externalEventId: event.externalEventId,
        },
      },
    });
    if (existingEvent?.status === "processed") {
      return { accepted: true, duplicate: true };
    }
    let duplicateEvent = Boolean(existingEvent);

    const attempt = await this.prisma.billingCheckoutAttempt.findUnique({
      where: { providerCheckoutRef: event.checkoutRef },
      include: { price: true },
    });
    if (!attempt) {
      throw new BillingDomainException(
        "BILLING_CHECKOUT_NOT_FOUND",
        "The payment checkout could not be found.",
      );
    }

    if (attempt.amountEgp !== event.amountEgp || attempt.currency !== event.currency) {
      throw new BillingDomainException(
        "BILLING_AMOUNT_MISMATCH",
        "The confirmed payment amount does not match the server-priced checkout.",
      );
    }

    if (existingEvent) {
      if (existingEvent.fingerprint !== event.fingerprint) {
        throw new BillingDomainException(
          "BILLING_PROVIDER_EVENT_DUPLICATE",
          "The provider event id was reused with different payload bytes.",
        );
      }
      await this.prisma.billingProviderEvent.update({
        where: {
          provider_externalEventId: {
            provider: event.provider,
            externalEventId: event.externalEventId,
          },
        },
        data: { status: "received", processedAt: null },
      });
    } else {
      try {
        await this.prisma.billingProviderEvent.create({
          data: {
            id: randomUUID(),
            billingAccountId: attempt.billingAccountId,
            provider: event.provider,
            externalEventId: event.externalEventId,
            fingerprint: event.fingerprint,
            eventType: event.eventType,
            signatureValid: event.signatureValid,
            status: "received",
            payload: event.payload as Prisma.InputJsonValue,
            receivedAt: event.occurredAt,
          },
        });
      } catch (error) {
        // Another webhook request may have inserted the same event between
        // the read and create. Re-read it and continue only when its payload
        // bytes match; a processed replay remains a no-op.
        if (!isPrismaUniqueError(error)) throw error;
        const raced = await this.prisma.billingProviderEvent.findUnique({
          where: {
            provider_externalEventId: {
              provider: event.provider,
              externalEventId: event.externalEventId,
            },
          },
        });
        if (!raced || raced.fingerprint !== event.fingerprint) {
          throw new BillingDomainException(
            "BILLING_PROVIDER_EVENT_DUPLICATE",
            "The provider event id was reused with different payload bytes.",
          );
        }
        duplicateEvent = true;
        if (raced.status === "processed") {
          return { accepted: true, duplicate: true };
        }
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        if (event.eventType === "checkout.paid") {
          await this.applyPaidEvent(tx, attempt, event);
        } else {
          await tx.billingCheckoutAttempt.update({
            where: { id: attempt.id },
            data: {
              status: event.eventType === "checkout.pending" ? "pending" : "failed",
            },
          });
        }
      });

      await this.prisma.billingProviderEvent.update({
        where: {
          provider_externalEventId: {
            provider: event.provider,
            externalEventId: event.externalEventId,
          },
        },
        data: { status: "processed", processedAt: new Date() },
      });
    } catch (error) {
      await this.prisma.billingProviderEvent.update({
        where: {
          provider_externalEventId: {
            provider: event.provider,
            externalEventId: event.externalEventId,
          },
        },
        data: { status: "failed" },
      });
      throw error;
    }

    return { accepted: true, duplicate: duplicateEvent };
  }

  async confirmSandboxCheckout(
    userId: string,
    providerCheckoutRef: string,
    outcome: "paid" | "failed" | "pending",
  ): Promise<BillingWebhookResult> {
    const nodeEnv = this.config.get<string>("app.nodeEnv") ?? "development";
    if (nodeEnv !== "development" && nodeEnv !== "test") {
      throw new NotFoundException();
    }
    if (this.paymentProvider.name !== "fake") {
      throw new BillingDomainException(
        "BILLING_PROVIDER_UNAVAILABLE",
        "The sandbox confirmation route is disabled for live providers.",
      );
    }

    const attempt = await this.prisma.billingCheckoutAttempt.findUnique({
      where: { providerCheckoutRef },
      include: { price: true },
    });
    if (!attempt) {
      throw new BillingDomainException(
        "BILLING_CHECKOUT_NOT_FOUND",
        "The sandbox checkout could not be found.",
      );
    }

    const account = await this.prisma.billingAccount.findFirst({
      where: { id: attempt.billingAccountId, ownerUserId: userId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException();
    }

    const eventType =
      outcome === "paid"
        ? "checkout.paid"
        : outcome === "pending"
          ? "checkout.pending"
          : "checkout.failed";
    const payload = this.fakePaymentProvider.createWebhookPayload({
      event_type: eventType,
      checkout_ref: providerCheckoutRef,
      transaction_ref: `fake_transaction_${randomUUID()}`,
      amount_egp: attempt.amountEgp,
      currency: "EGP",
      payment_mode: attempt.paymentMode as BillingPaymentMode,
    });
    const rawBody = Buffer.from(JSON.stringify(payload));
    return this.handleWebhook(
      this.paymentProvider.name,
      payload,
      rawBody,
      this.fakePaymentProvider.signWebhook(payload),
    );
  }

  private async applyPaidEvent(
    tx: Prisma.TransactionClient,
    attempt: CheckoutWithPrice,
    event: PaymentProviderEvent,
  ): Promise<void> {
    const existingTransaction = await tx.billingPaymentTransaction.findUnique({
      where: {
        provider_providerTransactionId: {
          provider: event.provider,
          providerTransactionId: event.transactionRef,
        },
      },
    });
    if (existingTransaction) {
      return;
    }

    const current = await tx.billingSubscription.findFirst({
      where: { billingAccountId: attempt.billingAccountId },
      orderBy: { createdAt: "desc" },
      include: { price: true },
    });
    const now = new Date();
    const baseDate =
      current?.paidThroughAt && current.paidThroughAt > now
        ? current.paidThroughAt
        : now;
    const paidThroughAt = addDays(baseDate, attempt.price.periodDays);
    const renewalMode = event.paymentMode === "recurring_card" ? "recurring_card" : "manual";
    const subscription = current
      ? await tx.billingSubscription.update({
          where: { id: current.id },
          data: {
            priceId: attempt.priceId,
            state: "active",
            renewalMode,
            provider: event.provider,
            paidThroughAt,
            graceEndsAt: null,
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
          },
        })
      : await tx.billingSubscription.create({
          data: {
            id: randomUUID(),
            billingAccountId: attempt.billingAccountId,
            priceId: attempt.priceId,
            state: "active",
            renewalMode,
            provider: event.provider,
            paidThroughAt,
          },
        });

    await tx.billingPaymentTransaction.create({
      data: {
        id: randomUUID(),
        billingAccountId: attempt.billingAccountId,
        subscriptionId: subscription.id,
        checkoutAttemptId: attempt.id,
        provider: event.provider,
        providerTransactionId: event.transactionRef,
        kind: "charge",
        status: "succeeded",
        amountEgp: event.amountEgp,
        currency: event.currency,
        paymentMode: event.paymentMode,
        occurredAt: event.occurredAt,
      },
    });

    await tx.billingCheckoutAttempt.update({
      where: { id: attempt.id },
      data: { status: "succeeded", confirmedAt: event.occurredAt },
    });

    await tx.billingOutbox.create({
      data: {
        id: randomUUID(),
        billingAccountId: attempt.billingAccountId,
        eventType: "billing.payment_confirmed",
        dedupeKey: `${event.provider}:${event.externalEventId}`,
        payload: {
          transaction_id: event.transactionRef,
          subscription_id: subscription.id,
          amount_egp: event.amountEgp,
        },
      },
    });
  }

  private async ensureBillingAccount(userId: string) {
    const existing = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId: userId },
    });
    if (existing) {
      return existing;
    }

    const trialPrice = await this.ensurePrice(BILLING_CATALOG[0]);
    const business = await this.prisma.business.findFirst({
      where: { ownerUserId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const trialStartedAt = new Date();
    const trialEndsAt = addDays(trialStartedAt, trialPrice.periodDays);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.billingAccount.create({
          data: {
            id: randomUUID(),
            ownerUserId: userId,
            activeBusinessId: business?.id,
          },
        });
        await tx.billingSubscription.create({
          data: {
            id: randomUUID(),
            billingAccountId: account.id,
            priceId: trialPrice.id,
            state: "trialing",
            renewalMode: "none",
            trialStartedAt,
            trialEndsAt,
          },
        });
        return account;
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const replay = await this.prisma.billingAccount.findUnique({
          where: { ownerUserId: userId },
        });
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async ensurePrice(price: BillingCatalogPrice) {
    const existing = await this.prisma.billingPrice.findUnique({
      where: { code: price.code },
    });
    if (existing) {
      if (
        existing.amountEgp !== price.amount_egp ||
        existing.currency !== price.currency ||
        existing.periodDays !== price.period_days
      ) {
        throw new InternalServerErrorException(
          "Persisted billing catalog does not match the reviewed launch catalog",
        );
      }
      return existing;
    }

    try {
      return await this.prisma.billingPrice.create({
        data: {
          id: randomUUID(),
          code: price.code,
          planCode: price.plan_code,
          interval: price.interval,
          amountEgp: price.amount_egp,
          currency: price.currency,
          periodDays: price.period_days,
          public: price.public,
          displayNameEn: price.display_name_en,
          displayNameAr: price.display_name_ar,
          entitlements: price.entitlements as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const replay = await this.prisma.billingPrice.findUnique({
          where: { code: price.code },
        });
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async findLatestSubscription(accountId: string) {
    return this.prisma.billingSubscription.findFirst({
      where: { billingAccountId: accountId },
      orderBy: { createdAt: "desc" },
      include: { price: true },
    });
  }

  private async findCheckoutByIdempotency(
    billingAccountId: string,
    idempotencyKey: string,
  ) {
    return this.prisma.billingCheckoutAttempt.findUnique({
      where: {
        billingAccountId_idempotencyKey: {
          billingAccountId,
          idempotencyKey,
        },
      },
      include: { price: true },
    });
  }

  private async refreshStateIfExpired(subscription: SubscriptionWithPrice) {
    const now = new Date();
    let nextState: string | null = null;
    if (
      subscription.state === "trialing" &&
      subscription.trialEndsAt &&
      subscription.trialEndsAt <= now
    ) {
      nextState = "expired";
    } else if (
      ["active", "cancel_at_period_end"].includes(subscription.state) &&
      subscription.paidThroughAt &&
      subscription.paidThroughAt <= now
    ) {
      if (!subscription.graceEndsAt) {
        nextState = "past_due";
      } else if (subscription.graceEndsAt <= now) {
        nextState = "expired";
      }
    }

    if (!nextState) return { subscription };
    const updated = await this.prisma.billingSubscription.update({
      where: { id: subscription.id },
      data: {
        state: nextState,
        graceEndsAt: nextState === "past_due" ? addDays(now, 7) : subscription.graceEndsAt,
      },
      include: { price: true },
    });
    return { subscription: updated };
  }
}

export class BillingDomainException extends ConflictException {
  constructor(readonly code: string, message: string) {
    super({ code, message });
  }
}

function toCheckoutResponse(attempt: CheckoutWithPrice): BillingCheckoutResponse {
  return {
    checkout_attempt_id: attempt.id,
    status: attempt.status as BillingCheckoutResponse["status"],
    checkout_url: attempt.providerCheckoutUrl ?? "",
    provider: attempt.provider,
    provider_checkout_ref: attempt.providerCheckoutRef ?? "",
    amount_egp: attempt.amountEgp,
    currency: "EGP",
    expires_at: attempt.expiresAt.toISOString(),
    sandbox: attempt.sandbox,
  };
}

function toSubscriptionResponse(
  accountId: string,
  subscription: SubscriptionWithPrice,
): BillingSubscriptionResponse {
  return {
    billing_account_id: accountId,
    state: subscription.state as BillingSubscriptionResponse["state"],
    plan_code: subscription.price.planCode as BillingSubscriptionResponse["plan_code"],
    price_code: subscription.price.code as BillingSubscriptionResponse["price_code"],
    amount_egp: subscription.price.amountEgp,
    currency: "EGP",
    renewal_mode: subscription.renewalMode as BillingSubscriptionResponse["renewal_mode"],
    paid_through_at: subscription.paidThroughAt?.toISOString() ?? null,
    grace_ends_at: subscription.graceEndsAt?.toISOString() ?? null,
    trial_ends_at: subscription.trialEndsAt?.toISOString() ?? null,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    payment_provider: subscription.provider,
    masked_payment_method: subscription.maskedPaymentMethod,
  };
}

function toTransactionResponse(
  transaction: TransactionRecord,
): BillingTransactionResponse {
  return {
    id: transaction.id,
    kind: transaction.kind as BillingTransactionResponse["kind"],
    status: transaction.status as BillingTransactionResponse["status"],
    amount_egp: transaction.amountEgp,
    currency: "EGP",
    provider: transaction.provider,
    payment_mode: transaction.paymentMode as BillingPaymentMode | null,
    occurred_at: transaction.occurredAt.toISOString(),
  };
}

function fingerprintCheckout(
  input: BillingCheckoutRequest,
  price: BillingCatalogPrice,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        price_code: price.code,
        payment_mode: input.payment_mode,
        amount_egp: price.amount_egp,
        currency: price.currency,
      }),
    )
    .digest("hex");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function usagePeriod(subscription: SubscriptionWithPrice): {
  periodStart: Date;
  periodEnd: Date;
} {
  const price = subscription.price;
  const periodEnd =
    price.interval === "trial"
      ? subscription.trialEndsAt ?? addDays(subscription.createdAt, price.periodDays)
      : subscription.paidThroughAt ?? addDays(subscription.createdAt, price.periodDays);
  const periodStart =
    price.interval === "trial"
      ? subscription.trialStartedAt ?? addDays(periodEnd, -price.periodDays)
      : addDays(periodEnd, -price.periodDays);
  return { periodStart, periodEnd };
}

function isAccessState(state: string): boolean {
  return ["trialing", "active", "past_due", "cancel_at_period_end"].includes(state);
}

function isPrismaUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
