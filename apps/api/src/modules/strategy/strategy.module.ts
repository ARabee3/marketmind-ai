import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';
import { StrategyRepository } from './strategy.repository';
import { PrismaModule } from '../../common/persistence/prisma.module';
import { StrategyProcessor } from './strategy.processor';
import { StrategyRateLimitGuard } from './strategy-rate-limit.guard';
import { BillingModule } from '../billing/billing.module';
import { StrategyProgressGateway } from './strategy-progress.gateway';
import { PublishingModule } from '../publishing/publishing.module';

@Module({
  imports: [
    JwtModule.register({}),
    PrismaModule,
    BillingModule,
    PublishingModule,
    HttpModule,
    BullModule.registerQueue({ name: 'strategy-generation' }),
  ],
  controllers: [StrategyController],
  providers: [
    StrategyService,
    StrategyRepository,
    StrategyProcessor,
    StrategyProgressGateway,
    StrategyRateLimitGuard,
  ],
  exports: [StrategyService, StrategyRepository],
})
export class StrategyModule {}
