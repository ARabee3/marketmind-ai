import { Module } from "@nestjs/common";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { IntelligenceContractMapper } from "./intelligence/intelligence-contract.mapper";

@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryRepository, DiscoveryService, IntelligenceContractMapper],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
