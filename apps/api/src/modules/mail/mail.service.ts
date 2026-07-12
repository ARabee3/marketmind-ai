import { Inject, Injectable } from "@nestjs/common";

import { MAIL_PROVIDER, MailProvider } from "./mail-provider";

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_PROVIDER) private readonly mailProvider: MailProvider,
  ) {}

  async sendMail(to: string, subject: string, html: string): Promise<void> {
    await this.mailProvider.send(to, subject, html);
  }
}
