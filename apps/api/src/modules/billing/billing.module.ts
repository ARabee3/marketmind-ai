import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { BillingController } from "./billing.controller";
import { BillingEntitlementsService } from "./billing-entitlements.service";
import { BillingService } from "./billing.service";
import { FakePaymentProvider } from "./fake-payment.provider";
import { PaymobPaymentProvider } from "./paymob-payment.provider";
import { PAYMENT_PROVIDER } from "./payment-provider.port";
import { BillingOutboxRepository } from "./billing-outbox.repository";
import { BillingOutboxProcessor } from "./billing-outbox.processor";
import { BillingOutboxReconciler } from "./billing-outbox.reconciler";
import { MailModule } from "../mail/mail.module";

@Module({
  imports: [
    ConfigModule,
    MailModule,
    BullModule.registerQueue({ name: "billing-outbox" }),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingEntitlementsService,
    FakePaymentProvider,
    PaymobPaymentProvider,
    BillingOutboxRepository,
    BillingOutboxProcessor,
    BillingOutboxReconciler,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, FakePaymentProvider, PaymobPaymentProvider],
      useFactory: (
        config: ConfigService,
        fake: FakePaymentProvider,
        paymob: PaymobPaymentProvider,
      ) => {
        const provider = config.get<string>("billing.provider") ?? "fake";
        if (provider === "fake") return fake;
        if (provider === "paymob") return paymob;
        if (provider === "geidea") {
          throw new Error(
            "Billing provider geidea is not implemented in this release; keep BILLING_PROVIDER=fake or paymob until the merchant adapter is approved.",
          );
        }
        throw new Error(`Unsupported billing provider: ${provider}`);
      },
    },
  ],
  exports: [BillingService, BillingEntitlementsService, PAYMENT_PROVIDER],
})
export class BillingModule {}
