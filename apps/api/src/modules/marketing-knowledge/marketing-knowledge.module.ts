import { Module } from "@nestjs/common";
import { MarketingKnowledgeEntryRepository } from "./marketing-knowledge-entry.repository";
import { MarketingKnowledgeVersionRepository } from "./marketing-knowledge-version.repository";
import { MarketingKnowledgeSourceRepository } from "./marketing-knowledge-source.repository";
import { MarketingKnowledgeChunkRepository } from "./marketing-knowledge-chunk.repository";
import { MarketingKnowledgeIngestionRunRepository } from "./marketing-knowledge-ingestion-run.repository";
import { MarketingKnowledgeEligibilityService } from "./marketing-knowledge-eligibility.service";
import { MarketingKnowledgeRebuildService } from "./marketing-knowledge-rebuild.service";

@Module({
  providers: [
    MarketingKnowledgeEntryRepository,
    MarketingKnowledgeVersionRepository,
    MarketingKnowledgeSourceRepository,
    MarketingKnowledgeChunkRepository,
    MarketingKnowledgeIngestionRunRepository,
    MarketingKnowledgeEligibilityService,
    MarketingKnowledgeRebuildService,
  ],
  exports: [
    MarketingKnowledgeEntryRepository,
    MarketingKnowledgeVersionRepository,
    MarketingKnowledgeSourceRepository,
    MarketingKnowledgeChunkRepository,
    MarketingKnowledgeIngestionRunRepository,
    MarketingKnowledgeEligibilityService,
    MarketingKnowledgeRebuildService,
  ],
})
export class MarketingKnowledgeModule {}