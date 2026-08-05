import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';
import { StrategyRepository } from './strategy.repository';
import { PrismaModule } from '../../common/persistence/prisma.module';
import { StrategyProcessor } from './strategy.processor';
import { StrategyRateLimitGuard } from './strategy-rate-limit.guard';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    PrismaModule,
    BillingModule,
    HttpModule,
    BullModule.registerQueue({ name: 'strategy-generation' }),
  ],
  controllers: [StrategyController],
  providers: [StrategyService, StrategyRepository, StrategyProcessor, StrategyRateLimitGuard],
  exports: [StrategyService, StrategyRepository],
})
export class StrategyModule {}
