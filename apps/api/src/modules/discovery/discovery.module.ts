import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { AiQueryPlanningClient } from "./ai-client/ai-query-planning.client";
import { ApifyMapsProvider } from "./intelligence/apify-maps.provider";
import { DeterministicQueryPlannerService } from "./intelligence/deterministic-query-planner.service";
import { DuckDuckGoSearchProvider } from "./intelligence/duckduckgo-search.provider";
import { IntelligenceContractMapper } from "./intelligence/intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import { MetadataExtractorService } from "./intelligence/metadata-extractor.service";
import { QueryPlannerService } from "./intelligence/query-planner.service";
import { SearchClientService } from "./intelligence/search-client.service";
import { SerpApiSearchProvider } from "./intelligence/serpapi-search.provider";

@Module({
  imports: [JwtModule.register({})],
  controllers: [DiscoveryController],
  providers: [
    DiscoveryRepository,
    DiscoveryIntelligenceRepository,
    DiscoveryService,
    DiscoveryProgressGateway,
    AiDiscoveryClient,
    IntelligenceContractMapper,
    IntelligenceGathererService,
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
