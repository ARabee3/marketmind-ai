import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { ResendAdapter } from './resend.adapter';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService, ResendAdapter],
  exports: [MailService],
})
export class MailModule {}
