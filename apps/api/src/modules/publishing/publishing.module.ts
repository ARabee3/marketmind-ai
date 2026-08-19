import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HttpModule } from "@nestjs/axios";

import { PrismaModule } from "../../common/persistence/prisma.module";
import { FacebookModule } from "../facebook/facebook.module";

// Candidates
import { CandidatesController } from "./candidates/candidates.controller";
import { InternalCandidatesController } from "./candidates/candidates.internal.controller";
import { CandidatesService } from "./candidates/candidates.service";
import { PUBLICATION_CANDIDATE_SINK } from "./candidates/publication-candidate-sink";

// Targets
import { TargetsController } from "./targets/targets.controller";
import { TargetsService } from "./targets/targets.service";
import { FacebookTargetBridgeService } from "./targets/facebook-target-bridge.service";
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
import { ContentAssetReader } from "./assets/content-asset.reader";
import { ContentAssetByteRetriever } from "./assets/content-asset-byte-retriever";
import { ManualExportArchiveService } from "./exports/manual-export-archive.service";
import { AssetStorageModule } from "../content/assets/asset-storage.module";

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
    AssetStorageModule,
    HttpModule,
    FacebookModule,
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
    {
      provide: PUBLICATION_CANDIDATE_SINK,
      useExisting: CandidatesService,
    },
    TargetsService,
    FacebookTargetBridgeService,
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
    ContentAssetReader,
    ContentAssetByteRetriever,
    ManualExportArchiveService,
    // Asset integrity boundary (issue #119 G4 / §9.2). The production
    // retriever reads approved Content media through the shared storage port,
    // so R2/filesystem configuration is owned by Content and bytes are proved
    // against the approved SHA-256 digest before any provider call. The
    // committed demo store is test-only.
    AssetIntegrityValidator,
    {
      provide: ASSET_BYTE_RETRIEVER,
      useExisting: ContentAssetByteRetriever,
    },
  ],
  exports: [
    CandidatesService,
    TargetsService,
    IntentsService,
    PUBLICATION_CANDIDATE_SINK,
    // Performance synchronization reuses the same server-side Meta adapter
    // and encrypted credential boundary as publishing. Neither provider
    // service is exposed through an HTTP module export.
    MetaGraphClient,
    CredentialVaultService,
  ],
})
export class PublishingModule {}
