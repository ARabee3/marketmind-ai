import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryReadinessService } from "./discovery-readiness.service";
import {
  DiscoverySessionStatus,
  IntelligenceResult,
} from "./discovery-state";
import { metadataForSuggestedAnswers } from "./discovery-suggested-answers";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

export type InitialQuestionResult =
  | "started"
  | "unavailable"
  | "already_started";

/**
 * Creates the first assistant question for a Discovery session.
 *
 * Shared by the background research worker (from `researching`) and the
 * owner-facing retry endpoint (from `partial_ready` / `research_failed` /
 * `ready_for_chat`). Idempotent: if an assistant message already exists, or a
 * concurrent persistence wins the race, the caller receives `already_started`
 * instead of a duplicate question.
 */
@Injectable()
export class DiscoveryInitialQuestionService {
  private readonly logger = new Logger(DiscoveryInitialQuestionService.name);

  constructor(
    private readonly conversationRepository: DiscoveryConversationRepository,
    private readonly aiDiscoveryClient: AiDiscoveryClient,
    private readonly readinessService: DiscoveryReadinessService,
  ) {}

  async ensureInitialQuestion(
    sessionId: string,
    dto: StartDiscoveryDto,
    intelligence: IntelligenceResult,
    allowedStatuses: readonly DiscoverySessionStatus[],
  ): Promise<InitialQuestionResult> {
    const existing = await this.conversationRepository.listMessages(sessionId);
    if (existing.some((message) => message.role === "assistant")) {
      this.logger.log(
        `Discovery initial question already exists for session ${sessionId}`,
      );
      return "already_started";
    }

    try {
      const result = await this.aiDiscoveryClient.start(
        sessionId,
        dto,
        intelligence,
      );
      if (result.safe_error || !result.next_question) {
        this.logger.warn(
          `Discovery initial question unavailable for session ${sessionId}: ${result.safe_error?.code ?? "no next question"}`,
        );
        return "unavailable";
      }

      await this.conversationRepository.recordInitialAssistantQuestion(
        sessionId,
        result.next_question,
        dto.language_mode ?? LanguageModeDto.Mixed,
        this.readinessService.evaluate(result, 0),
        metadataForSuggestedAnswers(result.suggested_answers),
        allowedStatuses,
      );
      return "started";
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.warn(
          `Discovery initial question provider error for session ${sessionId}: ${error.code}`,
        );
        return "unavailable";
      }
      if (error instanceof ConflictException) {
        this.logger.log(
          `Discovery initial question already recorded for session ${sessionId}`,
        );
        return "already_started";
      }
      throw error;
    }
  }
}