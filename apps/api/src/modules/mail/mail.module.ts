import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { BrevoMailProvider } from "./brevo-mail.provider";
import { MAIL_PROVIDER, MailProvider, MailProviderName } from "./mail-provider";
import { MailService } from "./mail.service";
import { MockMailProvider } from "./mock-mail.provider";

export function selectMailProvider(
  providerName: MailProviderName,
  mockProvider: MockMailProvider,
  brevoProvider: BrevoMailProvider,
): MailProvider {
  if (providerName === "brevo") {
    return brevoProvider;
  }

  return mockProvider;
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    MailService,
    MockMailProvider,
    BrevoMailProvider,
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService, MockMailProvider, BrevoMailProvider],
      useFactory: (
        configService: ConfigService,
        mockProvider: MockMailProvider,
        brevoProvider: BrevoMailProvider,
      ) =>
        selectMailProvider(
          configService.get<MailProviderName>("mail.provider") ?? "mock",
          mockProvider,
          brevoProvider,
        ),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
