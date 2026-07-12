import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { MAIL_PROVIDER, MailProvider, MailProviderName } from "./mail-provider";
import { MailService } from "./mail.service";
import { MockMailProvider } from "./mock-mail.provider";
import { SmtpMailProvider } from "./smtp-mail.provider";

export function selectMailProvider(
  providerName: MailProviderName,
  mockProvider: MockMailProvider,
  smtpProvider: SmtpMailProvider,
): MailProvider {
  if (providerName === "smtp") {
    return smtpProvider;
  }

  return mockProvider;
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    MailService,
    MockMailProvider,
    SmtpMailProvider,
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService, MockMailProvider, SmtpMailProvider],
      useFactory: (
        configService: ConfigService,
        mockProvider: MockMailProvider,
        smtpProvider: SmtpMailProvider,
      ) =>
        selectMailProvider(
          configService.get<MailProviderName>("mail.provider") ?? "mock",
          mockProvider,
          smtpProvider,
        ),
    },
  ],
  exports: [MailService],
})
export class MailModule {}