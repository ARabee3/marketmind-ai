import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HttpModule } from "@nestjs/axios";
import { ScheduleModule } from "@nestjs/schedule";

import { PrismaModule } from "../../common/persistence/prisma.module";

// Candidates
import { CandidatesController } from "./candidates/candidates.controller";
import { CandidatesService } from "./candidates/candidates.service";

// Targets
import { TargetsController } from "./targets/targets.controller";
import { TargetsService } from "./targets/targets.service";

// Intents
import { IntentsController } from "./intents/intents.controller";
import { IntentsService } from "./intents/intents.service";

// Dispatch
import { DispatchProcessor } from "./dispatch/dispatch.processor";
import { N8nClientService } from "./dispatch/n8n-client.service";
import {
  AssetIntegrityValidator,
  ASSET_BYTE_RETRIEVER,
  NullAssetByteRetriever,
} from "./dispatch/asset-integrity-validator";

// Callbacks
import { CallbacksController } from "./callbacks/callbacks.controller";

// Scheduling / Reconciliation
import { ReconciliationService } from "./scheduling/reconciliation.service";

// Admin
import { AdminController } from "./admin/admin.controller";

// Guards
import { BusinessOwnershipGuard } from "./common/guards/business-ownership.guard";

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: "publishing-dispatch" }),
  ],
  controllers: [
    CandidatesController,
    TargetsController,
    IntentsController,
    CallbacksController,
    AdminController,
  ],
  providers: [
    CandidatesService,
    TargetsService,
    IntentsService,
    DispatchProcessor,
    N8nClientService,
    ReconciliationService,
    BusinessOwnershipGuard,
    // Asset integrity boundary (issue #119 G4 / §9.2). The default
    // NullAssetByteRetriever throws PUBLISHING_ASSET_UNAVAILABLE so real
    // dispatch is blocked (never faked) until #121 supplies byte retrieval.
    // Binding the interface token lets #121 swap in a real retriever without
    // touching the dispatch processor.
    AssetIntegrityValidator,
    { provide: ASSET_BYTE_RETRIEVER, useClass: NullAssetByteRetriever },
  ],
  exports: [CandidatesService, TargetsService, IntentsService],
})
export class PublishingModule {}
