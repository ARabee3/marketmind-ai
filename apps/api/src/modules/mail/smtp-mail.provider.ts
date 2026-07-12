import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Transporter, createTransport } from "nodemailer";

import { MailDeliveryError } from "./mail-delivery.error";
import { MailProvider } from "./mail-provider";

/**
 * Sends transactional email through a standard SMTP server.
 *
 * Works for local development and production with any SMTP host (Gmail,
 * Mailgun, SES, etc.). Configuration comes from the SMTP_* environment
 * variables exposed via ConfigService as `mail.smtp.*`.
 */
@Injectable()
export class SmtpMailProvider implements MailProvider {
  private readonly logger = new Logger(SmtpMailProvider.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>("mail.smtp.host") ?? "";
    const port = this.configService.get<number>("mail.smtp.port") ?? 587;
    const user = this.configService.get<string>("mail.smtp.user") ?? "";
    const pass = this.configService.get<string>("mail.smtp.pass") ?? "";

    this.from = this.configService.get<string>("mail.from") ?? "";

    this.transporter =
      host && user && pass
        ? createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
          })
        : null;
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      throw new MailDeliveryError("SMTP mail provider is not configured");
    }
    if (!this.from) {
      throw new MailDeliveryError("MAIL_FROM is not configured");
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(`SMTP delivery failed: ${message}`);
      throw new MailDeliveryError(message);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "SMTP server rejected the email request";
  }
}