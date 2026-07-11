import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailDeliveryError } from './mail-delivery.error';

@Injectable()
export class ResendAdapter {
  private readonly logger = new Logger(ResendAdapter.name);
  private readonly client: Resend | null = null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('mail.resendApiKey');
    this.from = this.configService.get<string>('mail.from') ?? 'noreply@marketmind.ai';

    if (apiKey) {
      this.client = new Resend(apiKey);
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.client) {
      throw new MailDeliveryError('Resend API key not configured');
    }

    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });

    if (error) {
      this.logger.error(`Resend delivery failed: ${error.message}`, error);
      throw new MailDeliveryError(error.message);
    }
  }
}
