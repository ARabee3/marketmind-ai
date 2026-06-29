import { Module } from "@nestjs/common";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { AiQueryPlanningClient } from "./ai-client/ai-query-planning.client";
import { DeterministicQueryPlannerService } from "./intelligence/deterministic-query-planner.service";
import { DuckDuckGoSearchProvider } from "./intelligence/duckduckgo-search.provider";
import { IntelligenceContractMapper } from "./intelligence/intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import { QueryPlannerService } from "./intelligence/query-planner.service";
import { SearchClientService } from "./intelligence/search-client.service";
import { SerpApiSearchProvider } from "./intelligence/serpapi-search.provider";

@Module({
  controllers: [DiscoveryController],
  providers: [
    DiscoveryRepository,
    DiscoveryIntelligenceRepository,
    DiscoveryService,
    AiDiscoveryClient,
    IntelligenceContractMapper,
    IntelligenceGathererService,
    DeterministicQueryPlannerService,
    AiQueryPlanningClient,
    QueryPlannerService,
    SerpApiSearchProvider,
    DuckDuckGoSearchProvider,
    SearchClientService,
  ],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
