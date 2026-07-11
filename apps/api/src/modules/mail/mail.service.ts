import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResendAdapter } from './resend.adapter';
import { MailDeliveryError } from './mail-delivery.error';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly isProduction: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly resendAdapter: ResendAdapter,
  ) {
    this.isProduction = this.configService.get<string>('app.nodeEnv') === 'production';
  }

  async sendMail(to: string, subject: string, html: string): Promise<void> {
    if (this.isProduction) {
      await this.resendAdapter.send(to, subject, html);
      return;
    }

    this.logger.log(`[DEV MOCK] Email to: ${to}`);
    this.logger.log(`[DEV MOCK] Subject: ${subject}`);
    this.logger.log(`[DEV MOCK] Body: ${html.substring(0, 200)}...`);
  }
}
