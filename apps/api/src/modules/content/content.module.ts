import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HttpModule } from "@nestjs/axios";
import {
  ContentCycleController,
  ContentPackController,
  ContentAssetController,
  PublicationCandidateController,
} from "./content.controller";
import { ContentService } from "./content.service";
import { ContentAiClient } from "./content.client";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentDecisionRepository } from "./repositories/content-decision.repository";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";
import { ContentProcessor } from "./content.processor";
import { OutboxDispatcher } from "./outbox-dispatcher";
import { ContentRateLimitGuard } from "./content-rate-limit.guard";
import { ContentExceptionFilter } from "./content-exception.filter";
import { ContentScheduler } from "./content-scheduler.service";
import { ContentJobOutboxRepository } from "./content-job-outbox.repository";
import { ContentJobOutboxDispatcher } from "./content-job-outbox.dispatcher";
import { ContentV2Service } from "./v2/content-v2.service";
import { ContentV2Controller } from "./v2/content-v2.controller";
import { ContentSetupRepository } from "./v2/content-setup.repository";
import {
  ContentMediaLibraryRepository,
  ContentMediaValidator,
} from "./v2/content-media.repository";
import { ContentWeekPlanRepository } from "./v2/content-week-plan.repository";
import { ContentVersionEditRepository } from "./v2/content-version-edit.repository";
import { PrismaModule } from "../../common/persistence/prisma.module";
import { AssetStorageModule } from "./assets/asset-storage.module";
import { BillingModule } from "../billing/billing.module";
import { StrategyModule } from "../strategy/strategy.module";
import { PublishingModule } from "../publishing/publishing.module";
import { PerformanceModule } from "../performance/performance.module";

@Module({
  imports: [
    PrismaModule,
    BillingModule,
    HttpModule,
    AssetStorageModule,
    StrategyModule,
    PublishingModule,
    PerformanceModule,
    BullModule.registerQueue({ name: "content-generation" }),
    BullModule.registerQueue({ name: "content-outbox" }),
  ],
  controllers: [
    ContentCycleController,
    ContentPackController,
    ContentAssetController,
    PublicationCandidateController,
    ContentV2Controller,
  ],
  providers: [
    ContentService,
    ContentAiClient,
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
    ContentJobOutboxRepository,
    ContentJobOutboxDispatcher,
    ContentV2Service,
    ContentSetupRepository,
    ContentMediaLibraryRepository,
    ContentMediaValidator,
    ContentWeekPlanRepository,
    ContentVersionEditRepository,
  ],
  exports: [ContentService],
})
export class ContentModule {}
