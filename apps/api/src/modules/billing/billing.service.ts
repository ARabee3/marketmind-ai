import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  BILLING_BUNDLES,
  LOW_BALANCE_THRESHOLD_POINTS,
  TRIAL_GRANT_POINTS,
  getBillingBundle,
  pointsForMetric,
  type BillingCheckoutRequest,
  type BillingCheckoutResponse,
  type BillingMetric,
  type BillingPaymentMode,
  type BillingPointBundle,
  type BillingPointLedgerEntry,
  type BillingPointLedgerResponse,
  type BillingTransactionsResponse,
  type BillingTransactionResponse,
  type BillingWalletResponse,
} from "@marketmind/contracts";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../common/persistence/prisma.service";
import { FakePaymentProvider } from "./fake-payment.provider";
import { createPaymobTestHmac } from "./paymob-payment.provider";
import { ConfigService } from "@nestjs/config";
import {
  PAYMENT_PROVIDER,
  BillingProviderPayloadError,
  BillingProviderSignatureError,
  type PaymentProviderEvent,
  type PaymentProviderPort,
  type ProviderBillingData,
} from "./payment-provider.port";

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

export type ProviderCostRecord = {
  readonly metric: BillingMetric;
  readonly logicalArtifactKey: string;
  readonly businessId?: string;
  readonly provider: string;
  readonly model: string | null;
  readonly inputUnits?: number;
  readonly outputUnits?: number;
  readonly nativeCost?: number;
  readonly nativeCurrency?: string;
  readonly egpRate?: number;
  readonly egpCost?: number;
  readonly successfulArtifact: boolean;
  readonly retryCount: number;
};

/**
 * Prepaid points wallet. The owner buys a fixed EGP bundle via a one-time
 * hosted checkout; every successful AI action spends a fixed, published
 * number of points. The ledger is append-only and claim-key idempotent, so
 * queue replays and duplicate webhooks never double-charge or double-grant.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
    private readonly config: ConfigService,
    private readonly fakePaymentProvider: FakePaymentProvider,
  ) {}

  getBundles() {
    return {
      version: "billing-bundles-v1",
      currency: "EGP",
      bundles: BILLING_BUNDLES,
    };
  }

  async getWallet(userId: string): Promise<BillingWalletResponse> {
    const account = await this.ensureBillingAccount(userId);
    const balance = await this.prisma.billingPointBalance.findUnique({
      where: { billingAccountId: account.id },
    });
    if (!balance) {
      throw new InternalServerErrorException("Billing wallet could not be created");
    }
    return {
      billing_account_id: account.id,
      balance: balance.balance,
      lifetime_granted: balance.lifetimeGranted,
      lifetime_spent: balance.lifetimeSpent,
      low_balance: balance.balance < LOW_BALANCE_THRESHOLD_POINTS,
    };
  }

  async getLedger(userId: string): Promise<BillingPointLedgerResponse> {
    const account = await this.ensureBillingAccount(userId);
    const rows = await this.prisma.billingPointLedger.findMany({
      where: { billingAccountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      entries: rows.map(toLedgerEntry),
    };
  }

  /**
   * Debits points for a successful (or reserved) customer-visible artifact.
   * The account row is locked for the short transaction so concurrent workers
   * cannot overspend. A replay of the same claim key is a no-op.
   */
  async spendPoints(
    userId: string,
    metric: BillingMetric,
    units: number,
    claimKey: string,
  ): Promise<void> {
    if (!Number.isSafeInteger(units) || units <= 0) {
      throw new BillingDomainException(
        "BILLING_INSUFFICIENT_POINTS",
        "Points units must be a positive whole number.",
      );
    }
    const points = pointsForMetric(metric, units);
    if (points <= 0) return;

    const account = await this.ensureBillingAccount(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "billing_accounts"
        WHERE "id" = ${account.id}::uuid
        FOR UPDATE
      `;

      const existing = await tx.billingPointLedger.findUnique({
        where: {
          billingAccountId_claimKey: {
            billingAccountId: account.id,
            claimKey,
          },
        },
      });
      if (existing) return;

      const balance = await tx.billingPointBalance.findUnique({
        where: { billingAccountId: account.id },
      });
      if (!balance) {
        throw new InternalServerErrorException("Billing wallet is missing");
      }
      if (balance.balance < points) {
        throw new BillingDomainException(
          "BILLING_INSUFFICIENT_POINTS",
          "Not enough points for this action. Top up to continue.",
        );
      }

      const balanceAfter = balance.balance - points;
      await tx.billingPointBalance.update({
        where: { billingAccountId: account.id },
        data: {
          balance: balanceAfter,
          lifetimeSpent: { increment: points },
        },
      });
      try {
        await tx.billingPointLedger.create({
          data: {
            id: randomUUID(),
            billingAccountId: account.id,
            direction: "debit",
            reason: "spend",
            metric,
            points,
            balanceAfter,
            claimKey,
          },
        });
      } catch (error) {
        // A concurrent worker may have claimed the same key between the read
        // and create; treat the replay as a no-op.
        if (!isPrismaUniqueError(error)) throw error;
      }
    });
  }

  /**
   * Reverses a spend by claim key (credit "refund"), idempotent via the
   * derived `refund:<claimKey>` ledger claim. A claim key with no matching
   * debit is a no-op.
   */
  async refundPoints(userId: string, claimKey: string): Promise<void> {
    const account = await this.ensureBillingAccount(userId);
    const refundKey = `refund:${claimKey}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "billing_accounts"
        WHERE "id" = ${account.id}::uuid
        FOR UPDATE
      `;

      const existingRefund = await tx.billingPointLedger.findUnique({
        where: {
          billingAccountId_claimKey: {
            billingAccountId: account.id,
            claimKey: refundKey,
          },
        },
      });
      if (existingRefund) return;

      const spend = await tx.billingPointLedger.findUnique({
        where: {
          billingAccountId_claimKey: {
            billingAccountId: account.id,
            claimKey,
          },
        },
      });
      if (!spend || spend.direction !== "debit") return;

      const balance = await tx.billingPointBalance.findUnique({
        where: { billingAccountId: account.id },
      });
      if (!balance) {
        throw new InternalServerErrorException("Billing wallet is missing");
      }
      const balanceAfter = balance.balance + spend.points;
      await tx.billingPointBalance.update({
        where: { billingAccountId: account.id },
        data: { balance: balanceAfter },
      });
      try {
        await tx.billingPointLedger.create({
          data: {
            id: randomUUID(),
            billingAccountId: account.id,
            direction: "credit",
            reason: "refund",
            metric: spend.metric,
            points: spend.points,
            balanceAfter,
            claimKey: refundKey,
          },
        });
      } catch (error) {
        if (!isPrismaUniqueError(error)) throw error;
      }
    });
  }

  /**
   * Refunds the strategy-phase reserve for a deleted/abandoned cycle. The
   * phase charge claim key embeds the retrieval run, so the latest spend for
   * the strategy is looked up and reversed.
   */
  async releaseStrategyCycle(userId: string, strategyId: string): Promise<void> {
    const account = await this.ensureBillingAccount(userId);
    const spend = await this.prisma.billingPointLedger.findFirst({
      where: {
        billingAccountId: account.id,
        direction: "debit",
        reason: "spend",
        metric: "strategy_cycle",
        claimKey: { startsWith: `strategy-cycle:${strategyId}:` },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!spend) return;
    await this.refundPoints(userId, spend.claimKey);
  }

  /**
   * Records provider-cost telemetry for a provider-backed run. Margins are
   * measured against the published point menu, never guessed. Token and cost
   * fields are populated when the AI service reports usage; the write path
   * and snapshot version are stable.
   */
  async recordProviderCost(ownerUserId: string, input: ProviderCostRecord): Promise<void> {
    const account = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId },
      select: { id: true },
    });
    if (!account) return;
    await this.prisma.billingProviderCostLedger.upsert({
      where: {
        billingAccountId_logicalArtifactKey: {
          billingAccountId: account.id,
          logicalArtifactKey: input.logicalArtifactKey,
        },
      },
      update: {
        provider: input.provider,
        model: input.model,
        inputUnits: input.inputUnits ?? null,
        outputUnits: input.outputUnits ?? null,
        nativeCost: input.nativeCost ?? null,
        nativeCurrency: input.nativeCurrency ?? null,
        egpRate: input.egpRate ?? null,
        egpCost: input.egpCost ?? null,
        successfulArtifact: input.successfulArtifact,
        retryCount: input.retryCount,
      },
      create: {
        id: randomUUID(),
        billingAccountId: account.id,
        businessId: input.businessId,
        billingPeriodStart: periodStartForCostLedger(),
        provider: input.provider,
        model: input.model,
        logicalArtifactKey: input.logicalArtifactKey,
        inputUnits: input.inputUnits ?? null,
        outputUnits: input.outputUnits ?? null,
        nativeCost: input.nativeCost ?? null,
        nativeCurrency: input.nativeCurrency ?? null,
        egpRate: input.egpRate ?? null,
        egpCost: input.egpCost ?? null,
        successfulArtifact: input.successfulArtifact,
        quotaEffect: 0,
        retryCount: input.retryCount,
        snapshotVersion: "points-wallet-v1",
      },
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
    const bundle = getBillingBundle(input.bundle_code);
    if (!bundle) {
      throw new BillingDomainException(
        "BILLING_BUNDLE_NOT_FOUND",
        "That points bundle is not available.",
      );
    }
    if (input.payment_mode === "recurring_card") {
      throw new BillingDomainException(
        "BILLING_PROVIDER_UNAVAILABLE",
        "Subscriptions are not available; buy a points bundle instead.",
      );
    }

    const account = await this.ensureBillingAccount(userId);
    const storedPrice = await this.ensureBundlePrice(bundle);
    const requestFingerprint = fingerprintCheckout(input, bundle);
    const billingData = await this.resolveBillingData(userId);
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
          amountEgp: bundle.amount_egp,
          currency: bundle.currency,
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
        amountEgp: bundle.amount_egp,
        currency: bundle.currency,
        paymentMode: input.payment_mode,
        merchantReference: attempt.id,
        idempotencyKey: input.idempotency_key,
        billingData,
        metadata: {
          billing_account_id: account.id,
          bundle_code: bundle.code,
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
      this.logger.warn(
        `Checkout ${attempt.id} failed at the payment provider: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(
        "The payment provider is temporarily unavailable.",
      );
    }
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

    // Dev tooling must never double-credit an already-confirmed checkout.
    if (attempt.status === "succeeded") {
      return { accepted: true, duplicate: true };
    }

    if (this.paymentProvider.name === "fake") {
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

    if (this.paymentProvider.name === "paymob") {
      // Dev/test convenience: complete a Paymob checkout as paid/failed/pending
      // without a real card. The payload is a real Paymob TRANSACTION object
      // signed with the configured HMAC secret, so it exercises the exact same
      // webhook pipeline as a live callback (signature check, event dedupe,
      // transaction insert, points credit, outbox). Production envs reject
      // this route entirely.
      const hmacSecret =
        this.config.get<string>("billing.paymob.hmacSecret") ?? "";
      const integrationId =
        (this.config.get<unknown[]>("billing.paymob.integrationIds") ?? [])
          .map((value) => Number(value))
          .find((value) => Number.isSafeInteger(value) && value > 0) ?? 0;
      const transactionId =
        Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
      const transaction: Record<string, unknown> = {
        amount_cents: attempt.amountEgp * 100,
        created_at: new Date().toISOString(),
        currency: "EGP",
        error_occured: false,
        has_parent_transaction: false,
        id: transactionId,
        integration_id: integrationId,
        is_3d_secure: false,
        is_auth: true,
        is_capture: true,
        is_refund: false,
        is_refunded: false,
        is_standalone_payment: true,
        is_voided: false,
        order: { id: transactionId, merchant_order_id: attempt.id },
        owner: transactionId,
        pending: outcome === "pending",
        source_data: { pan: "0000", sub_type: "Test", type: "card" },
        success: outcome === "paid",
      };
      const hmac = createPaymobTestHmac(transaction, hmacSecret);
      const payload = { type: "TRANSACTION", obj: transaction, hmac };
      const rawBody = Buffer.from(JSON.stringify(payload));
      return this.handleWebhook("paymob", payload, rawBody, hmac);
    }

    throw new NotFoundException();
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

    const bundle = getBillingBundle(attempt.price.code);
    if (!bundle) {
      throw new BillingDomainException(
        "BILLING_BUNDLE_NOT_FOUND",
        "The paid checkout does not map to a points bundle.",
      );
    }

    // Row-lock the account so concurrent webhook deliveries cannot double-grant.
    await tx.$queryRaw`
      SELECT "id"
      FROM "billing_accounts"
      WHERE "id" = ${attempt.billingAccountId}::uuid
      FOR UPDATE
    `;

    const transaction = await tx.billingPaymentTransaction.create({
      data: {
        id: randomUUID(),
        billingAccountId: attempt.billingAccountId,
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

    const balance = await tx.billingPointBalance.findUnique({
      where: { billingAccountId: attempt.billingAccountId },
    });
    if (!balance) {
      throw new InternalServerErrorException("Billing wallet is missing");
    }
    const balanceAfter = balance.balance + bundle.points;
    await tx.billingPointBalance.update({
      where: { billingAccountId: attempt.billingAccountId },
      data: {
        balance: balanceAfter,
        lifetimeGranted: { increment: bundle.points },
      },
    });
    await tx.billingPointLedger.create({
      data: {
        id: randomUUID(),
        billingAccountId: attempt.billingAccountId,
        direction: "credit",
        reason: "topup",
        metric: null,
        points: bundle.points,
        balanceAfter,
        claimKey: `topup:${event.transactionRef}`,
        transactionId: transaction.id,
        expiresAt: addDays(new Date(), 365),
      },
    });

    await tx.billingOutbox.create({
      data: {
        id: randomUUID(),
        billingAccountId: attempt.billingAccountId,
        eventType: "billing.payment_confirmed",
        dedupeKey: `${event.provider}:${event.externalEventId}`,
        payload: {
          transaction_id: event.transactionRef,
          bundle_code: bundle.code,
          points_granted: bundle.points,
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

    const business = await this.prisma.business.findFirst({
      where: { ownerUserId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.billingAccount.create({
          data: {
            id: randomUUID(),
            ownerUserId: userId,
            activeBusinessId: business?.id,
          },
        });
        await tx.billingPointBalance.create({
          data: {
            id: randomUUID(),
            billingAccountId: account.id,
            balance: TRIAL_GRANT_POINTS,
            lifetimeGranted: TRIAL_GRANT_POINTS,
            lifetimeSpent: 0,
          },
        });
        await tx.billingPointLedger.create({
          data: {
            id: randomUUID(),
            billingAccountId: account.id,
            direction: "credit",
            reason: "trial_grant",
            metric: null,
            points: TRIAL_GRANT_POINTS,
            balanceAfter: TRIAL_GRANT_POINTS,
            claimKey: `trial-grant:${account.id}`,
            expiresAt: addDays(new Date(), 365),
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

  private async ensureBundlePrice(bundle: BillingPointBundle) {
    const existing = await this.prisma.billingPrice.findUnique({
      where: { code: bundle.code },
    });
    if (existing) {
      if (
        existing.amountEgp !== bundle.amount_egp ||
        existing.currency !== bundle.currency ||
        existing.periodDays !== 0 ||
        existing.pointsGranted !== bundle.points
      ) {
        throw new InternalServerErrorException(
          "Persisted billing catalog does not match the reviewed bundle catalog",
        );
      }
      return existing;
    }

    try {
      return await this.prisma.billingPrice.create({
        data: {
          id: randomUUID(),
          code: bundle.code,
          planCode: "points",
          interval: "one_time",
          amountEgp: bundle.amount_egp,
          currency: bundle.currency,
          periodDays: 0,
          pointsGranted: bundle.points,
          public: true,
          displayNameEn: bundle.display_name_en,
          displayNameAr: bundle.display_name_ar,
          entitlements: {},
        },
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const replay = await this.prisma.billingPrice.findUnique({
          where: { code: bundle.code },
        });
        if (replay) return replay;
      }
      throw error;
    }
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

  /**
   * Builds the customer billing data Paymob's Intention API requires. The
   * owner's email and name come from the User record; address and phone are
   * not yet collected by MarketMind, so neutral placeholders are sent so the
   * intention can be created while the hosted checkout collects the cardholder
   * payment details. Collecting real phone/address before live launch is a
   * tracked follow-up.
   */
  private async resolveBillingData(userId: string): Promise<ProviderBillingData> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true },
    });
    const fullName = user?.fullName?.trim() ?? "";
    const firstSpace = fullName.indexOf(" ");
    const firstName = firstSpace > 0 ? fullName.slice(0, firstSpace) : fullName || "MarketMind";
    const lastName = firstSpace > 0 ? fullName.slice(firstSpace + 1).trim() : "Customer";
    return {
      firstName,
      lastName,
      email: user?.email ?? "billing@marketmind.example",
      phone: "01000000000",
      apartment: "1",
      building: "1",
      floor: "1",
      street: "N/A",
      city: "Cairo",
      country: "EG",
      state: "Cairo",
      postalCode: "11511",
    };
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

function toLedgerEntry(
  row: Prisma.BillingPointLedgerGetPayload<{}>,
): BillingPointLedgerEntry {
  return {
    id: row.id,
    direction: row.direction as BillingPointLedgerEntry["direction"],
    reason: row.reason as BillingPointLedgerEntry["reason"],
    metric: (row.metric as BillingMetric | null) ?? null,
    points: row.points,
    balance_after: row.balanceAfter,
    created_at: row.createdAt.toISOString(),
  };
}

function fingerprintCheckout(
  input: BillingCheckoutRequest,
  bundle: BillingPointBundle,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        bundle_code: bundle.code,
        payment_mode: input.payment_mode,
        amount_egp: bundle.amount_egp,
        currency: bundle.currency,
      }),
    )
    .digest("hex");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function periodStartForCostLedger(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function isPrismaUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
