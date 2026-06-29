import { Injectable } from "@nestjs/common";
import { DiscoveryRepository } from "./discovery.repository";
import { StartDiscoveryDto, LanguageModeDto } from "./dto/start-discovery.dto";
import {
  DiscoveryStatusResponse,
  StartDiscoveryResponse,
  emptyRunningIntelligence,
} from "./discovery-state";

@Injectable()
export class DiscoveryService {
  constructor(private readonly discoveryRepository: DiscoveryRepository) {}

  async startPreparedDiscovery(
    ownerUserId: string,
    dto: StartDiscoveryDto,
  ): Promise<StartDiscoveryResponse> {
    const session = await this.discoveryRepository.createPreparedSession(ownerUserId, dto);

    return {
      session_id: session.id,
      status: "researching",
      progress_ws_url: `/ws/v1/discovery/${session.id}/progress`,
      status_url: `/api/v1/discovery/${session.id}/status`,
      accepted_at: session.startedAt.toISOString(),
    };
  }

  async getStatus(ownerUserId: string, sessionId: string): Promise<DiscoveryStatusResponse> {
    const session = await this.discoveryRepository.findSessionForOwner(ownerUserId, sessionId);
    const intake = session.intakes[0];

    return {
      session_id: session.id,
      status: session.status as DiscoveryStatusResponse["status"],
      language_mode: (session.languageMode as LanguageModeDto) ?? LanguageModeDto.Mixed,
      current_question: session.currentQuestion ?? undefined,
      intake_summary: {
        business_name: intake?.businessName ?? "",
        business_type: intake?.businessType ?? "",
        city: intake?.city ?? "",
        area: intake?.area ?? undefined,
      },
      intelligence: emptyRunningIntelligence(),
      messages: [],
      progress_events: [],
      strategy_locked: true,
    };
  }
}
