import { Injectable, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import { MailService } from "../mail/mail.service";
import { BillingOutboxRepository } from "./billing-outbox.repository";

interface BillingOutboxJobData {
  eventId: string;
}

/**
 * Authoritative billing outbox payload emitted atomically with the succeeded
 * payment transaction (`billing.payment_confirmed`). Email-safe: it carries
 * no provider credentials or payment secrets.
 */
interface PaymentConfirmedPayload {
  readonly transaction_ref?: string;
  readonly bundle_code?: string;
  readonly bundle_name_en?: string;
  readonly bundle_name_ar?: string;
  readonly points_granted?: number;
  readonly amount_egp?: number;
  readonly currency?: string;
  readonly confirmed_at?: string;
}

@Processor("billing-outbox")
@Injectable()
export class BillingOutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingOutboxProcessor.name);

  constructor(
    private readonly outbox: BillingOutboxRepository,
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<BillingOutboxJobData>): Promise<void> {
    const { eventId } = job.data;
    const leaseOwner = `billing-mail-worker:${String(job.id ?? randomUUID())}`;

    const event = await this.outbox.claimEventById(eventId, leaseOwner);
    if (!event) {
      this.logger.warn(`Billing outbox event ${eventId} is not claimable`);
      return;
    }

    try {
      await this.sendConfirmationEmail(event);
      await this.outbox.markDispatched(eventId, leaseOwner);
      this.logger.log(
        `Billing confirmation email dispatched for event ${eventId}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Billing confirmation email failed for event ${eventId}: ${message}`,
      );
      await this.outbox.releaseForRetry(eventId, leaseOwner, message);
      throw error;
    }
  }

  private async sendConfirmationEmail(
    event: Prisma.BillingOutboxGetPayload<Record<string, never>>,
  ): Promise<void> {
    const payload = (event.payload ?? {}) as PaymentConfirmedPayload;
    const account = await this.prisma.billingAccount.findUnique({
      where: { id: event.billingAccountId },
      select: { ownerUserId: true },
    });
    if (!account) {
      throw new Error(`Billing account ${event.billingAccountId} not found`);
    }

    const bundleFallback = payload.bundle_code ?? "";
    await this.mailService.sendBillingPaymentConfirmation({
      ownerUserId: account.ownerUserId,
      bundleNameEn: payload.bundle_name_en ?? bundleFallback,
      bundleNameAr: payload.bundle_name_ar ?? bundleFallback,
      pointsGranted: payload.points_granted ?? 0,
      amountEgp: payload.amount_egp ?? 0,
      currency: payload.currency ?? "EGP",
      transactionRef: payload.transaction_ref ?? event.dedupeKey,
      confirmedAt: payload.confirmed_at
        ? new Date(payload.confirmed_at)
        : event.createdAt,
    });
  }
}
