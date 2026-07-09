import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { AiEvidenceTriageClient } from "./ai-client/ai-evidence-triage.client";
import { DiscoveryConversationService } from "./discovery-conversation.service";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryRateLimitGuard } from "./discovery-rate-limit.guard";
import { DiscoveryRedisLimiterService } from "./discovery-redis-limiter.service";
import { DiscoveryReadinessService } from "./discovery-readiness.service";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { DiscoveryQueueModule } from "./discovery-queue.module";
import { DiscoveryQueueWorker } from "./discovery-queue.worker";
import { DiscoveryResearchProcessor } from "./discovery-research.processor";
import { AiQueryPlanningClient } from "./ai-client/ai-query-planning.client";
import { ApifyMapsProvider } from "./intelligence/apify-maps.provider";
import { DeterministicQueryPlannerService } from "./intelligence/deterministic-query-planner.service";
import { DuckDuckGoSearchProvider } from "./intelligence/duckduckgo-search.provider";
import { EvidenceTriageService } from "./intelligence/evidence-triage.service";
import { IntelligenceContractMapper } from "./intelligence/intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import { MetadataExtractorService } from "./intelligence/metadata-extractor.service";
import { QueryPlannerService } from "./intelligence/query-planner.service";
import { SearchClientService } from "./intelligence/search-client.service";
import { SerpApiSearchProvider } from "./intelligence/serpapi-search.provider";

@Module({
  imports: [JwtModule.register({}), DiscoveryQueueModule],
  controllers: [DiscoveryController],
  providers: [
    DiscoveryRepository,
    DiscoveryConversationRepository,
    DiscoveryIntelligenceRepository,
    DiscoveryConversationService,
    DiscoveryRateLimitGuard,
    DiscoveryRedisLimiterService,
    DiscoveryReadinessService,
    DiscoveryService,
    DiscoveryQueueWorker,
    DiscoveryResearchProcessor,
    DiscoveryProgressGateway,
    AiDiscoveryClient,
    AiEvidenceTriageClient,
    IntelligenceContractMapper,
    IntelligenceGathererService,
    EvidenceTriageService,
    MetadataExtractorService,
    DeterministicQueryPlannerService,
    AiQueryPlanningClient,
    QueryPlannerService,
    ApifyMapsProvider,
    SerpApiSearchProvider,
    DuckDuckGoSearchProvider,
    SearchClientService,
  ],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
