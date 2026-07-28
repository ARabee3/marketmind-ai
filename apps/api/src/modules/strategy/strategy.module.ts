import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';
import { StrategyRepository } from './strategy.repository';
import { PrismaModule } from '../../common/persistence/prisma.module';
import { StrategyProcessor } from './strategy.processor';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    BullModule.registerQueue({ name: 'strategy-generation' }),
  ],
  controllers: [StrategyController],
  providers: [StrategyService, StrategyRepository, StrategyProcessor],
  exports: [StrategyService],
})
export class StrategyModule {}
