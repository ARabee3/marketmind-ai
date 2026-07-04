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
  DiscoverySummarizeDto,
} from "./dto/discovery-conversation.dto";
import {
  LanguageModeDto,
  PreparedDiscoveryIntakeDto,
} from "./dto/start-discovery.dto";
import {
  BusinessProfileDraft,
  ConfirmProfileResponse,
  DiscoveryCompletionReason,
  DiscoveryMessage,
  DiscoveryProfileState,
  DiscoveryRespondResponse,
  DiscoverySessionStatus,
  DiscoverySummarizeResponse,
  IntelligenceResult,
} from "./discovery-state";
import { DiscoveryReadinessService } from "./discovery-readiness.service";
import { MAX_DISCOVERY_OWNER_TURNS } from "./market-profile";

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
    private readonly readinessService: DiscoveryReadinessService,
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

    const ownerTurnCount = session.ownerTurnCount + 1;
    const profileState = this.readinessService.evaluate(result, ownerTurnCount);

    const completionReason: DiscoveryCompletionReason | undefined = profileState
      .readiness.ready
      ? "sufficient"
      : ownerTurnCount >= MAX_DISCOVERY_OWNER_TURNS
        ? "turn_limit"
        : undefined;
    if (completionReason) {
      const completed = await this.completeDiscovery(
        sessionId,
        languageMode,
        intake,
        session.intelligence,
        [...messages, ownerMessage],
        profileState,
        completionReason,
        true,
      );

      return {
        session_id: sessionId,
        status: "summary_ready",
        assistant_message: completed.assistantMessage,
        updated_known_facts: completed.profileDraft.confirmed_facts,
        uncertainties: completed.profileState.uncertainties,
        readiness: completed.profileState.readiness,
        profile_draft: completed.profileDraft,
        strategy_locked: true,
      };
    }

    const assistantMessage =
      await this.conversationRepository.completeConversationTurn(
        sessionId,
        CONVERSATION_STATUSES,
        "in_progress",
        result.next_question,
        undefined,
        {
          role: "assistant",
          content: result.next_question!,
          language: languageMode,
          source: "chat",
        },
        profileState,
        true,
      );

    return {
      session_id: sessionId,
      status: "in_progress",
      assistant_message: assistantMessage,
      updated_known_facts: result.updated_known_facts,
      uncertainties: result.updated_uncertainties,
      readiness: profileState.readiness,
      strategy_locked: true,
    };
  }

  async summarizeDiscovery(
    ownerUserId: string,
    sessionId: string,
    dto: DiscoverySummarizeDto = {},
  ): Promise<DiscoverySummarizeResponse> {
    const session = await this.discoveryRepository.findSessionForOwner(
      ownerUserId,
      sessionId,
    );
    assertStatusAllows(session.status, CONVERSATION_STATUSES);
    if (!session.profileState.readiness.ready && dto.finish_anyway !== true) {
      throw new ConflictException({
        code: "DISCOVERY_PROFILE_NOT_READY",
        message:
          "Discovery still has blocking profile gaps. Set finish_anyway to create an incomplete draft.",
        readiness: session.profileState.readiness,
      });
    }

    const languageMode = languageModeFromSession(session.languageMode);
    const intake = await this.conversationRepository.getIntake(sessionId);
    const messages = await this.conversationRepository.listMessages(sessionId);
    const reason: DiscoveryCompletionReason = session.profileState.readiness
      .ready
      ? "sufficient"
      : "owner_finished_early";
    const completed = await this.completeDiscovery(
      sessionId,
      languageMode,
      intake,
      session.intelligence,
      messages,
      session.profileState,
      reason,
      false,
    );

    return {
      session_id: sessionId,
      status: "summary_ready",
      profile_draft: completed.profileDraft,
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
      dto.acknowledge_incomplete === true,
    );
  }

  private async completeDiscovery(
    sessionId: string,
    languageMode: LanguageModeDto,
    intake: PreparedDiscoveryIntakeDto,
    intelligence: IntelligenceResult,
    messages: readonly DiscoveryMessage[],
    profileState: DiscoveryProfileState,
    reason: DiscoveryCompletionReason,
    incrementOwnerTurn: boolean,
  ): Promise<{
    profileDraft: BusinessProfileDraft;
    profileState: DiscoveryProfileState;
    assistantMessage: DiscoveryMessage;
  }> {
    const stateWithReason = this.readinessService.withCompletionReason(
      profileState,
      reason,
    );
    const completeness = reason === "sufficient" ? "complete" : "incomplete";
    const result = await this.aiDiscoveryClient.summarize(
      sessionId,
      languageMode,
      intake,
      intelligence,
      messages,
      {
        reason,
        completeness,
        readiness: stateWithReason.readiness,
      },
    );
    if (result.safe_error) {
      throw new ProviderError(
        result.safe_error.code,
        result.safe_error.message,
        result.safe_error.retryable,
      );
    }
    const draft = result.profile_draft;
    if (!draft) {
      throw new ProviderError(
        "AI_DISCOVERY_PROFILE_DRAFT_MISSING",
        "AI discovery did not return a profile draft.",
        true,
      );
    }
    if (
      draft.session_id !== sessionId ||
      draft.completeness !== completeness ||
      draft.completion_reason !== reason
    ) {
      throw new ProviderError(
        "AI_DISCOVERY_INVALID_OUTPUT",
        "AI discovery returned a profile draft for another session or completion context.",
        true,
      );
    }

    const completedState: DiscoveryProfileState = {
      known_facts: draft.confirmed_facts,
      uncertainties: draft.uncertainties.map(
        ({
          resolved: _resolved,
          resolved_at: _at,
          resolved_by_action: _by,
          ...input
        }) => input,
      ),
      readiness: stateWithReason.readiness,
    };
    const saved =
      await this.conversationRepository.completeConversationWithDraft(
        sessionId,
        CONVERSATION_STATUSES,
        draft,
        completedState,
        reason,
        {
          role: "assistant",
          content: "Profile draft is ready for confirmation.",
          language: languageMode,
          source: "summary",
        },
        incrementOwnerTurn,
      );

    return {
      profileDraft: saved.draft,
      profileState: completedState,
      assistantMessage: saved.assistantMessage,
    };
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
