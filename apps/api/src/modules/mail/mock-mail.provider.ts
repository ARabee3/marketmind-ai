import { Injectable, Logger } from "@nestjs/common";

import { MailProvider } from "./mail-provider";

@Injectable()
export class MockMailProvider implements MailProvider {
  private readonly logger = new Logger(MockMailProvider.name);

  async send(to: string, subject: string, html: string): Promise<void> {
    this.logger.log(`[MAIL MOCK] Email to: ${to}`);
    this.logger.log(`[MAIL MOCK] Subject: ${subject}`);
    this.logger.log(`[MAIL MOCK] Body: ${html.substring(0, 200)}...`);
  }
}
