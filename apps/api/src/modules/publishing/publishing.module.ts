import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HttpModule } from "@nestjs/axios";
import { ScheduleModule } from "@nestjs/schedule";

import { PrismaModule } from "../../common/persistence/prisma.module";

// Candidates
import { CandidatesController } from "./candidates/candidates.controller";
import { InternalCandidatesController } from "./candidates/candidates.internal.controller";
import { CandidatesService } from "./candidates/candidates.service";

// Targets
import { TargetsController } from "./targets/targets.controller";
import { TargetsService } from "./targets/targets.service";
import { MetaConnectionService } from "./targets/meta-connection.service";
import { MetaOAuthCallbackController } from "./targets/meta-oauth-callback.controller";

// Meta OAuth / credential vault (issue #175)
import { CredentialVaultService } from "./credentials/credential-vault.service";
import { MetaGraphClient } from "./meta/meta-graph.client";
import { MetaOAuthStateStore } from "./meta/meta-oauth-state.store";

// Dispatch
import { DispatchProcessor } from "./dispatch/dispatch.processor";
import { N8nClientService } from "./dispatch/n8n-client.service";
import { DispatchEnvelopeBuilder } from "./dispatch/dispatch-envelope.builder";
import { MetaProviderExecutor } from "./dispatch/meta-provider.executor";
import { MediaFetchTokenService } from "./dispatch/media-fetch-token.service";
import {
  MetaExecutorController,
  MediaFetchController,
} from "./dispatch/meta-executor.controller";
import {
  AssetIntegrityValidator,
  ASSET_BYTE_RETRIEVER,
} from "./dispatch/asset-integrity-validator";

// Assets (#121)
import { AssetsController } from "./assets/assets.controller";
import { PublishingAssetStore } from "./assets/publishing-asset.store";
import { LocalFilesystemAssetByteRetriever } from "./assets/asset-byte-retriever";
import { ManualExportArchiveService } from "./exports/manual-export-archive.service";

// Intents
import { IntentsController } from "./intents/intents.controller";
import { IntentsService } from "./intents/intents.service";

// Callbacks
import { CallbacksController } from "./callbacks/callbacks.controller";

// Scheduling / Reconciliation
import { ReconciliationService } from "./scheduling/reconciliation.service";

// Admin
import { AdminController } from "./admin/admin.controller";

// Guards
import { BusinessOwnershipGuard } from "./common/guards/business-ownership.guard";
import { InternalAuthGuard } from "./common/guards/internal-auth.guard";

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: "publishing-dispatch" }),
  ],
  controllers: [
    CandidatesController,
    InternalCandidatesController,
    TargetsController,
    MetaOAuthCallbackController,
    IntentsController,
    CallbacksController,
    AdminController,
    AssetsController,
    MetaExecutorController,
    MediaFetchController,
  ],
  providers: [
    CandidatesService,
    TargetsService,
    MetaConnectionService,
    CredentialVaultService,
    MetaGraphClient,
    MetaOAuthStateStore,
    MetaProviderExecutor,
    MediaFetchTokenService,
    IntentsService,
    DispatchProcessor,
    N8nClientService,
    DispatchEnvelopeBuilder,
    ReconciliationService,
    BusinessOwnershipGuard,
    InternalAuthGuard,
    PublishingAssetStore,
    ManualExportArchiveService,
    // Asset integrity boundary (issue #119 G4 / §9.2). #121 supplies the real
    // byte retrieval via the committed local-filesystem store so dispatch
    // proves retrieved media bytes against the approved SHA-256 digests before
    // any provider call. The NullAssetByteRetriever remains available for
    // tests and environments without a configured asset store.
    AssetIntegrityValidator,
    {
      provide: ASSET_BYTE_RETRIEVER,
      useFactory: (store: PublishingAssetStore) =>
        new LocalFilesystemAssetByteRetriever(store),
      inject: [PublishingAssetStore],
    },
  ],
  exports: [CandidatesService, TargetsService, IntentsService],
})
export class PublishingModule {}
