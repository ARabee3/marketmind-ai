import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
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

@Module({
  imports: [
    PrismaModule,
    FacebookModule,
    PublishingModule,
    BullModule.registerQueue({ name: FACEBOOK_PERFORMANCE_QUEUE }),
  ],
  controllers: [PerformanceController],
  providers: [
    PerformanceRepository,
    FacebookPerformanceProvider,
    PerformanceProcessor,
    PerformanceReconciler,
    PerformanceService,
  ],
  exports: [PerformanceService, PerformanceRepository],
})
export class PerformanceModule {}
