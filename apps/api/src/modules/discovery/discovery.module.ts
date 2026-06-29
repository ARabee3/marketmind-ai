import { Module } from "@nestjs/common";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { AiQueryPlanningClient } from "./ai-client/ai-query-planning.client";
import { DeterministicQueryPlannerService } from "./intelligence/deterministic-query-planner.service";
import { IntelligenceContractMapper } from "./intelligence/intelligence-contract.mapper";
import { QueryPlannerService } from "./intelligence/query-planner.service";

@Module({
  controllers: [DiscoveryController],
  providers: [
    DiscoveryRepository,
    DiscoveryService,
    IntelligenceContractMapper,
    DeterministicQueryPlannerService,
    AiQueryPlanningClient,
    QueryPlannerService,
  ],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
