import { Injectable, Logger } from "@nestjs/common";
import { externalProviderConfig } from "../../common/config/external-provider.config";
import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryRepository } from "./discovery.repository";
import { StartDiscoveryDto, LanguageModeDto } from "./dto/start-discovery.dto";
import {
  DiscoveryProgressInput,
  DiscoveryStatusResponse,
  StartDiscoveryResponse,
} from "./discovery-state";
import { progressEventsFromPersistence } from "./discovery-progress.mapper";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly conversationRepository: DiscoveryConversationRepository,
    private readonly intelligenceRepository: DiscoveryIntelligenceRepository,
    private readonly intelligenceGatherer: IntelligenceGathererService,
    private readonly aiDiscoveryClient: AiDiscoveryClient,
    private readonly progressGateway: DiscoveryProgressGateway,
  ) {}

  async startPreparedDiscovery(
    ownerUserId: string,
    dto: StartDiscoveryDto,
  ): Promise<StartDiscoveryResponse> {
    const session = await this.discoveryRepository.createPreparedSession(
      ownerUserId,
      dto,
    );
    await this.recordProgress(session.id, {
      stage: "session",
      status: "completed",
      messageKey: "discovery.session.accepted",
      messageText: "Discovery request accepted.",
    });
    // ponytail: process-local background work; move to a queue if restarts or retries matter.
    void this.runPreparedDiscovery(session.id, dto);

    return {
      session_id: session.id,
      status: "researching",
      progress_ws_url: "/ws/v1/discovery",
      status_url: `/api/v1/discovery/${session.id}/status`,
      accepted_at: session.startedAt.toISOString(),
    };
  }

  private async runPreparedDiscovery(
    sessionId: string,
    dto: StartDiscoveryDto,
  ): Promise<void> {
    try {
      await this.recordProgress(sessionId, {
        stage: "intelligence",
        status: "started",
        messageKey: "discovery.intelligence.started",
        messageText: "Research started.",
      });
      const intelligence = await withResearchDeadline(
        (signal) =>
          this.intelligenceGatherer.gather(
            dto,
            (event) => {
              signal.throwIfAborted();
              return this.recordProgress(sessionId, event);
            },
            signal,
          ),
        externalProviderConfig().discoveryResearchTimeoutMs,
      );
      await this.recordProgress(sessionId, {
        stage: "persisting",
        status: "started",
        messageKey: "discovery.persisting.started",
        messageText: "Saving research results.",
      });
      await this.intelligenceRepository.saveIntelligenceResult(
        sessionId,
        intelligence,
      );
      await this.recordProgress(sessionId, {
        stage: "persisting",
        status: "completed",
        messageKey: "discovery.persisting.completed",
        messageText: "Research results were saved.",
      });
      await this.recordProgress(sessionId, {
        stage: "intelligence",
        status: "completed",
        messageKey: "discovery.intelligence.completed",
        messageText: "Research finished.",
        payload: {
          status: intelligence.status,
          source_count: intelligence.source_refs.length,
          observation_count: intelligence.research_observations.length,
        },
      });
      await this.recordProgress(sessionId, {
        stage: "ai_discovery",
        status: "started",
        messageKey: "discovery.ai.started",
        messageText: "Preparing the first discovery question.",
      });
      const aiStarted = await this.startAiDiscovery(
        sessionId,
        dto,
        intelligence,
      );
      await this.recordProgress(sessionId, {
        stage: "ai_discovery",
        status: aiStarted ? "completed" : "failed",
        messageKey: aiStarted
          ? "discovery.ai.completed"
          : "discovery.ai.provider_unavailable",
        messageText: aiStarted
          ? "First discovery question is ready."
          : "AI discovery provider is not available yet.",
      });
      if (!aiStarted) {
        return;
      }
      await this.recordProgress(sessionId, {
        stage: "ready",
        status: "completed",
        messageKey: "discovery.ready_for_chat",
        messageText: "Discovery chat is ready.",
      });
    } catch (error) {
      await this.handleBackgroundFailure(sessionId, error);
    }
  }

  private async startAiDiscovery(
    sessionId: string,
    dto: StartDiscoveryDto,
    intelligence: Awaited<ReturnType<IntelligenceGathererService["gather"]>>,
  ): Promise<boolean> {
    try {
      const result = await this.aiDiscoveryClient.start(
        sessionId,
        dto,
        intelligence,
      );
      if (result.safe_error || !result.next_question) {
        return false;
      }
      await this.conversationRepository.recordInitialAssistantQuestion(
        sessionId,
        result.next_question,
        dto.language_mode ?? LanguageModeDto.Mixed,
      );
      return true;
    } catch (error) {
      if (error instanceof ProviderError) {
        return false;
      }
      throw error;
    }
  }

  private async handleBackgroundFailure(
    sessionId: string,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      "Discovery background research failed",
      error instanceof Error ? error.stack : String(error),
    );
    const failed = await this.discoveryRepository.updateStatusIfCurrent(
      sessionId,
      ["researching", "partial_ready", "ready_for_chat", "research_failed"],
      "failed",
    );
    if (!failed) {
      return;
    }
    await this.recordProgress(sessionId, {
      stage: "background",
      status: "failed",
      messageKey: "discovery.background.failed",
      messageText: "Discovery research failed.",
      payload: {
        code: "DISCOVERY_BACKGROUND_FAILED",
        retryable: true,
      },
    });
  }

  private async recordProgress(
    sessionId: string,
    event: DiscoveryProgressInput,
  ): Promise<void> {
    const savedEvent = await this.discoveryRepository.appendProgressEvent(
      sessionId,
      event,
    );
    this.progressGateway.emitProgress(sessionId, savedEvent);
  }

  async getStatus(
    ownerUserId: string,
    sessionId: string,
  ): Promise<DiscoveryStatusResponse> {
    const session = await this.discoveryRepository.findSessionForOwner(
      ownerUserId,
      sessionId,
    );
    const [messages, profileDraft] = await Promise.all([
      this.conversationRepository.listMessages(sessionId),
      this.conversationRepository.latestProfileDraft(sessionId),
    ]);
    const intake = session.intakes[0];

    return {
      session_id: session.id,
      status: session.status as DiscoveryStatusResponse["status"],
      language_mode:
        (session.languageMode as LanguageModeDto) ?? LanguageModeDto.Mixed,
      current_question: session.currentQuestion ?? undefined,
      intake_summary: {
        business_name: intake?.businessName ?? "",
        business_type: intake?.businessType ?? "",
        city: intake?.city ?? "",
        area: intake?.area ?? undefined,
      },
      intelligence: session.intelligence,
      messages,
      profile_draft: profileDraft,
      progress_events: progressEventsFromPersistence(session.progressEvents),
      strategy_locked: session.status !== "confirmed",
    };
  }
}

async function withResearchDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error("Discovery research exceeded its time limit."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
