import { Module } from "@nestjs/common";
import { PrismaModule } from "../../common/persistence/prisma.module";
import { OrchestrationRepository } from "./orchestration.repository";
import { OrchestrationService } from "./orchestration.service";

@Module({
  imports: [PrismaModule],
  providers: [OrchestrationRepository, OrchestrationService],
  exports: [OrchestrationRepository, OrchestrationService],
})
export class OrchestrationModule {}
