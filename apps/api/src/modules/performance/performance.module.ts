import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HttpModule } from "@nestjs/axios";
import { PrismaModule } from "../../common/persistence/prisma.module";
import { FacebookModule } from "../facebook/facebook.module";
import { PublishingModule } from "../publishing/publishing.module";
import { PerformanceController } from "./performance.controller";
import { FacebookPerformanceProvider } from "./facebook-performance.provider";
import { PerformanceProcessor } from "./performance.processor";
import { PerformanceReconciler } from "./performance.reconciler";
import { PerformanceService } from "./performance.service";
import { FACEBOOK_PERFORMANCE_QUEUE } from "./performance.constants";
import { PerformanceRepository } from "../publishing/performance/performance.repository";
import { OptimizationController } from "./optimization/optimization.controller";
import { OptimizationAiClient } from "./optimization/optimization-ai.client";
import { OptimizationRepository } from "./optimization/optimization.repository";
import { OptimizationService } from "./optimization/optimization.service";

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    FacebookModule,
    PublishingModule,
    BullModule.registerQueue({ name: FACEBOOK_PERFORMANCE_QUEUE }),
  ],
  controllers: [PerformanceController, OptimizationController],
  providers: [
    PerformanceRepository,
    FacebookPerformanceProvider,
    PerformanceProcessor,
    PerformanceReconciler,
    PerformanceService,
    OptimizationAiClient,
    OptimizationRepository,
    OptimizationService,
  ],
  exports: [PerformanceService, PerformanceRepository, OptimizationService],
})
export class PerformanceModule {}
