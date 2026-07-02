import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryRepository } from "./discovery.repository";
import {
  ConfirmProfileDto,
  DiscoveryRespondDto,
} from "./dto/discovery-conversation.dto";
import { LanguageModeDto } from "./dto/start-discovery.dto";
import {
  BusinessProfileDraft,
  ConfirmProfileResponse,
  DiscoveryRespondResponse,
  DiscoverySessionStatus,
  DiscoverySummarizeResponse,
} from "./discovery-state";

const CONVERSATION_STATUSES: readonly DiscoverySessionStatus[] = [
  "partial_ready",
  "ready_for_chat",
  "research_failed",
  "in_progress",
];

@Injectable()
export class DiscoveryConversationService {
  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly conversationRepository: DiscoveryConversationRepository,
    private readonly aiDiscoveryClient: AiDiscoveryClient,
  ) {}

  async respondToDiscovery(
    ownerUserId: string,
    sessionId: string,
    dto: DiscoveryRespondDto,
  ): Promise<DiscoveryRespondResponse> {
    const session = await this.discoveryRepository.findSessionForOwner(
      ownerUserId,
      sessionId,
    );
    assertStatusAllows(session.status, CONVERSATION_STATUSES);
    const languageMode = languageModeFromSession(session.languageMode);
    const intake = await this.conversationRepository.getIntake(sessionId);
    const messages = await this.conversationRepository.listMessages(sessionId);
    const ownerMessage = await this.conversationRepository.appendMessage(
      sessionId,
      {
        role: "owner",
        content: dto.message,
        language: dto.language ?? languageMode,
        source: "chat",
      },
    );
    const result = await this.aiDiscoveryClient.respond(
      sessionId,
      languageMode,
      intake,
      session.intelligence,
      messages,
      ownerMessage,
    );
    if (result.safe_error) {
      throw new ProviderError(
        result.safe_error.code,
        result.safe_error.message,
        result.safe_error.retryable,
      );
    }

    const profileDraft = await this.persistProfileDraft(
      sessionId,
      result.profile_draft,
    );
    const status = profileDraft ? "summary_ready" : "in_progress";
    const assistantMessage =
      await this.conversationRepository.completeConversationTurn(
        sessionId,
        CONVERSATION_STATUSES,
        status,
        result.next_question,
        profileDraft?.id,
        result.next_question
          ? {
              role: "assistant",
              content: result.next_question,
              language: languageMode,
              source: profileDraft ? "summary" : "chat",
            }
          : undefined,
      );

    return {
      session_id: sessionId,
      status,
      assistant_message: assistantMessage,
      updated_known_facts: result.updated_known_facts,
      uncertainties: result.updated_uncertainties,
      profile_draft: profileDraft,
      strategy_locked: true,
    };
  }

  async summarizeDiscovery(
    ownerUserId: string,
    sessionId: string,
  ): Promise<DiscoverySummarizeResponse> {
    const session = await this.discoveryRepository.findSessionForOwner(
      ownerUserId,
      sessionId,
    );
    assertStatusAllows(session.status, CONVERSATION_STATUSES);
    const languageMode = languageModeFromSession(session.languageMode);
    const intake = await this.conversationRepository.getIntake(sessionId);
    const messages = await this.conversationRepository.listMessages(sessionId);
    const result = await this.aiDiscoveryClient.summarize(
      sessionId,
      languageMode,
      intake,
      session.intelligence,
      messages,
    );
    const profileDraft = await this.persistProfileDraft(
      sessionId,
      result.profile_draft,
    );
    if (!profileDraft) {
      throw new ProviderError(
        "AI_DISCOVERY_PROFILE_DRAFT_MISSING",
        "AI discovery did not return a profile draft.",
        true,
      );
    }

    await this.conversationRepository.completeConversationTurn(
      sessionId,
      CONVERSATION_STATUSES,
      "summary_ready",
      undefined,
      profileDraft.id,
      {
        role: "assistant",
        content: "Profile draft is ready for confirmation.",
        language: languageMode,
        source: "summary",
      },
    );

    return {
      session_id: sessionId,
      status: "summary_ready",
      profile_draft: profileDraft,
      strategy_locked: true,
    };
  }

  async confirmProfile(
    ownerUserId: string,
    sessionId: string,
    dto: ConfirmProfileDto,
  ): Promise<ConfirmProfileResponse> {
    if (dto.owner_confirmation !== true) {
      throw new BadRequestException("Profile confirmation is required");
    }

    const session = await this.discoveryRepository.findSessionForOwner(
      ownerUserId,
      sessionId,
    );
    assertStatusAllows(session.status, ["summary_ready", "confirmed"]);
    const intake = await this.conversationRepository.getIntake(session.id);

    return this.conversationRepository.confirmProfile(
      ownerUserId,
      sessionId,
      dto.profile_draft_id,
      intake,
    );
  }

  private async persistProfileDraft(
    sessionId: string,
    draft: BusinessProfileDraft | undefined,
  ): Promise<BusinessProfileDraft | undefined> {
    if (!draft) {
      return undefined;
    }
    if (draft.session_id !== sessionId) {
      throw new ProviderError(
        "AI_DISCOVERY_INVALID_OUTPUT",
        "AI discovery returned a profile draft for another session.",
        true,
      );
    }

    return this.conversationRepository.saveProfileDraft(draft);
  }
}

function assertStatusAllows(
  status: DiscoverySessionStatus,
  allowedStatuses: readonly DiscoverySessionStatus[],
): void {
  if (!allowedStatuses.includes(status)) {
    throw new ConflictException(
      "Discovery session is not in a valid state for this action",
    );
  }
}

function languageModeFromSession(value: string): LanguageModeDto {
  switch (value) {
    case LanguageModeDto.ArabicEgypt:
    case LanguageModeDto.English:
    case LanguageModeDto.Mixed:
      return value;
    default:
      return LanguageModeDto.Mixed;
  }
}
