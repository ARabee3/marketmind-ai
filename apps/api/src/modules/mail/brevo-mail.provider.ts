import { randomUUID } from "crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BrevoClient } from "@getbrevo/brevo";

import { MailDeliveryError } from "./mail-delivery.error";
import { MailProvider } from "./mail-provider";

const BREVO_TIMEOUT_SECONDS = 10;
const BREVO_MAX_RETRIES = 1;

@Injectable()
export class BrevoMailProvider implements MailProvider {
  private readonly logger = new Logger(BrevoMailProvider.name);
  private readonly client: BrevoClient | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("mail.brevoApiKey");
    this.from = this.configService.get<string>("mail.from") ?? "";
    this.client = apiKey
      ? new BrevoClient({
          apiKey,
          timeoutInSeconds: BREVO_TIMEOUT_SECONDS,
          maxRetries: BREVO_MAX_RETRIES,
        })
      : null;
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.client || !this.from) {
      throw new MailDeliveryError("Brevo mail provider is not configured");
    }

    const idempotencyKey = randomUUID();

    try {
      await this.client.transactionalEmails.sendTransacEmail({
        sender: { email: this.from, name: "MarketMind AI" },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        headers: { idempotencyKey },
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(`Brevo delivery failed: ${message}`);
      throw new MailDeliveryError(message);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "Brevo rejected the email request";
  }
}
