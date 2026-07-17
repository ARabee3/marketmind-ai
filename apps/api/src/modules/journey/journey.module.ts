import { Module } from "@nestjs/common";
import { JourneyController } from "./journey.controller";
import { JourneyRepository } from "./journey.repository";
import { JourneyService } from "./journey.service";

@Module({
  controllers: [JourneyController],
  providers: [JourneyRepository, JourneyService],
})
export class JourneyModule {}
