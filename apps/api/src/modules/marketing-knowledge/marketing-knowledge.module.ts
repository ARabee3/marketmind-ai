import { Module } from "@nestjs/common";
import { MarketingKnowledgeEntryRepository } from "./marketing-knowledge-entry.repository";
import { MarketingKnowledgeVersionRepository } from "./marketing-knowledge-version.repository";
import { MarketingKnowledgeSourceRepository } from "./marketing-knowledge-source.repository";
import { MarketingKnowledgeChunkRepository } from "./marketing-knowledge-chunk.repository";
import { MarketingKnowledgeIngestionRunRepository } from "./marketing-knowledge-ingestion-run.repository";
import { MarketingKnowledgeEligibilityService } from "./marketing-knowledge-eligibility.service";
import { MarketingKnowledgeRebuildService } from "./marketing-knowledge-rebuild.service";
import { KnowledgeLibraryAdminService } from "./admin/knowledge-library-admin.service";
import { KnowledgeLibraryAdminController } from "./admin/knowledge-library-admin.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [KnowledgeLibraryAdminController],
  providers: [
    MarketingKnowledgeEntryRepository,
    MarketingKnowledgeVersionRepository,
    MarketingKnowledgeSourceRepository,
    MarketingKnowledgeChunkRepository,
    MarketingKnowledgeIngestionRunRepository,
    MarketingKnowledgeEligibilityService,
    MarketingKnowledgeRebuildService,
    KnowledgeLibraryAdminService,
  ],
  exports: [
    MarketingKnowledgeEntryRepository,
    MarketingKnowledgeVersionRepository,
    MarketingKnowledgeSourceRepository,
    MarketingKnowledgeChunkRepository,
    MarketingKnowledgeIngestionRunRepository,
    MarketingKnowledgeEligibilityService,
    MarketingKnowledgeRebuildService,
    KnowledgeLibraryAdminService,
  ],
})
export class MarketingKnowledgeModule {}
