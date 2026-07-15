import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ProviderError } from "../../common/errors/provider-error";
import { DiscoveryRepository } from "./discovery.repository";
import { StartDiscoveryDto } from "./dto/start-discovery.dto";
import {
  DiscoveryProgressInput,
  DiscoveryStatusResponse,
  StartDiscoveryResponse,
} from "./discovery-state";
import { progressEventsFromPersistence } from "./discovery-progress.mapper";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { LanguageModeDto } from "./dto/start-discovery.dto";
import { DiscoveryQueueProducer } from "./discovery-queue.producer";
import { suggestedAnswersFromMetadata } from "./discovery-suggested-answers";

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly conversationRepository: DiscoveryConversationRepository,
    private readonly progressGateway: DiscoveryProgressGateway,
    private readonly queueProducer: DiscoveryQueueProducer,
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

    await this.recordProgress(session.id, {
      stage: "queued",
      status: "started",
      messageKey: "discovery.queued.started",
      messageText: "Discovery research queued.",
    });

    try {
      await this.queueProducer.enqueueResearch(session.id);
    } catch (error) {
      await this.recordProgress(session.id, {
        stage: "queued",
        status: "failed",
        messageKey: "discovery.queued.failed",
        messageText: "Failed to queue discovery research.",
        payload: {
          code: "DISCOVERY_ENQUEUE_FAILED",
          retryable: true,
        },
      });
      await this.discoveryRepository.updateStatusIfCurrent(
        session.id,
        ["researching"],
        "failed",
      );

      if (error instanceof ProviderError) {
        throw new ServiceUnavailableException({
          code: error.code,
          message: error.message,
        });
      }
      throw new ServiceUnavailableException({
        code: "DISCOVERY_ENQUEUE_FAILED",
        message: "Failed to queue discovery research",
      });
    }

    return {
      session_id: session.id,
      status: "researching",
      progress_ws_url: "/ws/v1/discovery",
      status_url: `/api/v1/discovery/${session.id}/status`,
      accepted_at: session.startedAt.toISOString(),
    };
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
      current_suggested_answers: currentSuggestedAnswers(
        messages,
        session.currentQuestion,
      ),
      intake_summary: {
        business_name: intake?.businessName ?? "",
        business_type: intake?.businessType ?? "",
        city: intake?.city ?? "",
        area: intake?.area ?? undefined,
      },
      intelligence: session.intelligence,
      messages,
      profile_draft: profileDraft,
      profile_state: session.profileState,
      progress_events: progressEventsFromPersistence(session.progressEvents),
      strategy_locked: session.status !== "confirmed",
    };
  }
}

function currentSuggestedAnswers(
  messages: readonly {
    readonly role: string;
    readonly content: string;
    readonly suggested_answers?: readonly string[];
  }[],
  currentQuestion: string | null,
): string[] | undefined {
  const current = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        (!currentQuestion || message.content === currentQuestion),
    );
  return suggestedAnswersFromMetadata({
    suggested_answers: current?.suggested_answers,
  });
}
