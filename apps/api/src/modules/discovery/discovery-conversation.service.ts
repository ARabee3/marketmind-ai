import { BadRequestException, Injectable } from "@nestjs/common";
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
  DiscoverySummarizeResponse,
} from "./discovery-state";

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

    const profileDraft = await this.persistProfileDraft(result.profile_draft);
    const assistantMessage = result.next_question
      ? await this.conversationRepository.appendMessage(sessionId, {
          role: "assistant",
          content: result.next_question,
          language: languageMode,
          source: profileDraft ? "summary" : "chat",
        })
      : undefined;
    const status = profileDraft ? "summary_ready" : "in_progress";
    await this.conversationRepository.updateSessionConversationState(
      sessionId,
      status,
      result.next_question,
      profileDraft?.id,
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
    const profileDraft = await this.persistProfileDraft(result.profile_draft);
    if (!profileDraft) {
      throw new ProviderError(
        "AI_DISCOVERY_PROFILE_DRAFT_MISSING",
        "AI discovery did not return a profile draft.",
        true,
      );
    }

    await this.conversationRepository.appendMessage(sessionId, {
      role: "assistant",
      content: "Profile draft is ready for confirmation.",
      language: languageMode,
      source: "summary",
    });
    await this.conversationRepository.updateSessionConversationState(
      sessionId,
      "summary_ready",
      undefined,
      profileDraft.id,
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
    const intake = await this.conversationRepository.getIntake(session.id);

    return this.conversationRepository.confirmProfile(
      ownerUserId,
      sessionId,
      dto.profile_draft_id,
      intake,
    );
  }

  private async persistProfileDraft(
    draft: BusinessProfileDraft | undefined,
  ): Promise<BusinessProfileDraft | undefined> {
    if (!draft) {
      return undefined;
    }

    return this.conversationRepository.saveProfileDraft(draft);
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
