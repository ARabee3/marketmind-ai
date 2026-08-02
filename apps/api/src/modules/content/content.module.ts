import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import {
  ContentCycleController,
  ContentPackController,
  ContentAssetController,
  PublicationCandidateController,
} from './content.controller';
import { ContentService } from './content.service';
import { ContentPackRepository } from './repositories/content-pack.repository';
import { ContentCycleRepository } from './repositories/content-cycle.repository';
import { ContentWeekContextRepository } from './repositories/content-week-context.repository';
import { ContentDecisionRepository } from './repositories/content-decision.repository';
import { PublicationCandidateRepository } from './repositories/publication-candidate.repository';
import { ContentProcessor } from './content.processor';
import { OutboxDispatcher } from './outbox-dispatcher';
import { ContentRateLimitGuard } from './content-rate-limit.guard';
import { ContentExceptionFilter } from './content-exception.filter';
import { ContentScheduler } from './content-scheduler.service';
import { PrismaModule } from '../../common/persistence/prisma.module';
import { AssetStorageModule } from './assets/asset-storage.module';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    AssetStorageModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: 'content-generation' }),
    BullModule.registerQueue({ name: 'content-outbox' }),
  ],
  controllers: [
    ContentCycleController,
    ContentPackController,
    ContentAssetController,
    PublicationCandidateController,
  ],
  providers: [
    ContentService,
    ContentPackRepository,
    ContentCycleRepository,
    ContentWeekContextRepository,
    ContentDecisionRepository,
    PublicationCandidateRepository,
    ContentProcessor,
    OutboxDispatcher,
    ContentRateLimitGuard,
    ContentExceptionFilter,
    ContentScheduler,
  ],
  exports: [ContentService],
})
export class ContentModule {}
