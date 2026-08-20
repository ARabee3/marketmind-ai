import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../common/persistence/prisma.service";
import { MAIL_PROVIDER, MailProvider } from "./mail-provider";
import { MailDeliveryError } from "./mail-delivery.error";
import {
  normalizeLocale,
  renderBillingConfirmation,
  renderFacebookExpired,
  type MailLocale,
} from "./mail-templates";

export interface BillingPaymentConfirmationInput {
  readonly ownerUserId: string;
  readonly bundleNameEn: string;
  readonly bundleNameAr: string;
  readonly pointsGranted: number;
  readonly amountEgp: number;
  readonly currency: string;
  readonly transactionRef: string;
  readonly confirmedAt: Date;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_PROVIDER) private readonly mailProvider: MailProvider,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async sendMail(to: string, subject: string, html: string): Promise<void> {
    await this.mailProvider.send(to, subject, html);
  }

  /**
   * Notifies the user that their connected Facebook Page token has expired or
   * been revoked (detected reactively at publish/test time) and asks them to
   * reconnect from the Connections page.
   *
   * Mail failures are logged but never thrown — the caller's publish flow
   * must not break because a notification could not be delivered.
   */
  async sendFacebookExpiredEmail(userId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, preferredLocale: true },
      });
      if (!user) {
        this.logger.warn(
          `Facebook expiry email skipped: user ${userId} not found`,
        );
        return;
      }

      const appUrl =
        this.config.get<string>("mail.appUrl") ?? "http://localhost:3000";
      const { subject, html } = renderFacebookExpired(
        { appUrl },
        normalizeLocale(user.preferredLocale),
      );

      await this.sendMail(user.email, subject, html);
    } catch (error) {
      this.logger.error(
        `Failed to send Facebook expiry email to user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Sends the localized points-purchase confirmation email to the billing
   * account owner after the payment is authoritatively committed.
   *
   * Unlike the fire-and-forget Facebook expiry notification, delivery
   * failures THROW (MailDeliveryError) so the billing outbox worker can
   * release the event for a retry. The confirmed payment, wallet credit, and
   * ledger entry are never rolled back because mail failed. Credentials and
   * payment secrets are never included in the body or the logged message.
   */
  async sendBillingPaymentConfirmation(
    input: BillingPaymentConfirmationInput,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.ownerUserId },
      select: { email: true, preferredLocale: true },
    });
    if (!user) {
      throw new MailDeliveryError(
        `Billing confirmation owner ${input.ownerUserId} not found`,
      );
    }

    const locale = normalizeLocale(user.preferredLocale);
    const appUrl =
      this.config.get<string>("mail.appUrl") ?? "http://localhost:3000";
    const { subject, html } = renderBillingConfirmation(
      {
        bundleName:
          locale === "en" ? input.bundleNameEn : input.bundleNameAr,
        pointsGranted: String(input.pointsGranted),
        amountEgp: String(input.amountEgp),
        currency: input.currency,
        transactionRef: input.transactionRef,
        confirmedAt: formatConfirmationDate(input.confirmedAt, locale),
        billingUrl: `${appUrl}/billing`,
        appUrl,
      },
      locale,
    );

    await this.sendMail(user.email, subject, html);
  }
}

function formatConfirmationDate(date: Date, locale: MailLocale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-EG" : "ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
