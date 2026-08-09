import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../common/persistence/prisma.service";
import { MAIL_PROVIDER, MailProvider } from "./mail-provider";
import { normalizeLocale, renderFacebookExpired } from "./mail-templates";

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
}
