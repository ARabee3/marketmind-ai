import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  BusinessProfileDraft,
  DiscoveryCompletionReason,
  ConfirmProfileResponse,
  DiscoveryMessage,
  DiscoveryProfileState,
  DiscoverySessionStatus,
} from "./discovery-state";
import {
  messageFromPersistence,
  profileDraftFromPersistence,
} from "./discovery-conversation.mapper";
import { PreparedDiscoveryIntakeDto } from "./dto/start-discovery.dto";

type MessageInput = {
  readonly role: DiscoveryMessage["role"];
  readonly content: string;
  readonly language: DiscoveryMessage["language"];
  readonly source: DiscoveryMessage["source"];
  readonly metadata?: Record<string, unknown>;
};

@Injectable()
export class DiscoveryConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async appendMessage(
    sessionId: string,
    message: MessageInput,
  ): Promise<DiscoveryMessage> {
    const saved = await this.prisma.discoveryMessage.create({
      data: {
        sessionId,
        role: message.role,
        content: message.content,
        language: message.language,
        source: message.source,
        metadata: jsonForPrisma(message.metadata ?? {}),
      },
    });

    return messageFromPersistence(saved);
  }

  async listMessages(sessionId: string): Promise<DiscoveryMessage[]> {
    const messages = await this.prisma.discoveryMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });

    return messages.map(messageFromPersistence);
  }

  async latestProfileDraft(
    sessionId: string,
  ): Promise<BusinessProfileDraft | undefined> {
    const draft = await this.prisma.businessProfileDraft.findFirst({
      where: { sessionId },
      orderBy: { version: "desc" },
    });

    return draft ? profileDraftFromPersistence(draft) : undefined;
  }

  async saveProfileDraft(
    draft: BusinessProfileDraft,
  ): Promise<BusinessProfileDraft> {
    const saved = await this.prisma.businessProfileDraft.upsert({
      where: {
        sessionId_version: {
          sessionId: draft.session_id,
          version: draft.version,
        },
      },
      create: {
        id: draft.id,
        sessionId: draft.session_id,
        version: draft.version,
        status: draft.status,
        completeness: draft.completeness,
        completionReason: draft.completion_reason,
        readiness: jsonForPrisma(draft.readiness),
        confirmedFacts: jsonForPrisma(draft.confirmed_facts),
        researchObservations: jsonForPrismaArray(draft.research_observations),
        uncertainties: jsonForPrismaArray(draft.uncertainties),
        ownerGoals: jsonForPrismaArray(draft.owner_goals),
        strategyRelevantNotes: jsonForPrismaArray(
          draft.strategy_relevant_notes,
        ),
        rawAiOutput: jsonForPrisma(draft.raw_ai_output),
      },
      update: {
        status: draft.status,
        completeness: draft.completeness,
        completionReason: draft.completion_reason,
        readiness: jsonForPrisma(draft.readiness),
        confirmedFacts: jsonForPrisma(draft.confirmed_facts),
        researchObservations: jsonForPrismaArray(draft.research_observations),
        uncertainties: jsonForPrismaArray(draft.uncertainties),
        ownerGoals: jsonForPrismaArray(draft.owner_goals),
        strategyRelevantNotes: jsonForPrismaArray(
          draft.strategy_relevant_notes,
        ),
        rawAiOutput: jsonForPrisma(draft.raw_ai_output),
      },
    });

    return profileDraftFromPersistence(saved);
  }

  async completeConversationTurn(
    sessionId: string,
    allowedStatuses: readonly DiscoverySessionStatus[],
    status: "in_progress" | "summary_ready",
    currentQuestion?: string,
    profileDraftId?: string,
    assistantMessage?: MessageInput,
    profileState?: DiscoveryProfileState,
    incrementOwnerTurn = false,
  ): Promise<DiscoveryMessage | undefined> {
    const savedMessage = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.discoverySession.updateMany({
        where: {
          id: sessionId,
          status: { in: [...allowedStatuses] },
        },
        data: {
          status,
          currentQuestion: currentQuestion ?? null,
          profileDraftId,
          ...(profileState
            ? { profileState: jsonForPrisma(profileState) }
            : {}),
          ...(incrementOwnerTurn ? { ownerTurnCount: { increment: 1 } } : {}),
        },
      });

      if (transition.count !== 1) {
        throw invalidDiscoveryState();
      }

      if (!assistantMessage) {
        return undefined;
      }

      return tx.discoveryMessage.create({
        data: {
          sessionId,
          role: assistantMessage.role,
          content: assistantMessage.content,
          language: assistantMessage.language,
          source: assistantMessage.source,
          metadata: jsonForPrisma(assistantMessage.metadata ?? {}),
        },
      });
    });

    return savedMessage ? messageFromPersistence(savedMessage) : undefined;
  }

  async completeConversationWithDraft(
    sessionId: string,
    allowedStatuses: readonly DiscoverySessionStatus[],
    draft: BusinessProfileDraft,
    profileState: DiscoveryProfileState,
    completionReason: DiscoveryCompletionReason,
    assistantMessage: MessageInput,
    incrementOwnerTurn: boolean,
  ): Promise<{
    draft: BusinessProfileDraft;
    assistantMessage: DiscoveryMessage;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.discoverySession.updateMany({
        where: {
          id: sessionId,
          status: { in: [...allowedStatuses] },
        },
        data: {
          status: "summary_ready",
          currentQuestion: null,
          profileDraftId: draft.id,
          profileState: jsonForPrisma(profileState),
          completionReason,
          ...(incrementOwnerTurn ? { ownerTurnCount: { increment: 1 } } : {}),
        },
      });
      if (transition.count !== 1) {
        throw invalidDiscoveryState();
      }

      const savedDraft = await tx.businessProfileDraft.upsert({
        where: {
          sessionId_version: {
            sessionId: draft.session_id,
            version: draft.version,
          },
        },
        create: profileDraftCreateData(draft),
        update: profileDraftUpdateData(draft),
      });
      const savedMessage = await tx.discoveryMessage.create({
        data: {
          sessionId,
          role: assistantMessage.role,
          content: assistantMessage.content,
          language: assistantMessage.language,
          source: assistantMessage.source,
          metadata: jsonForPrisma(assistantMessage.metadata ?? {}),
        },
      });

      return { savedDraft, savedMessage };
    });

    return {
      draft: profileDraftFromPersistence(result.savedDraft),
      assistantMessage: messageFromPersistence(result.savedMessage),
    };
  }

  async recordInitialAssistantQuestion(
    sessionId: string,
    content: string,
    language: DiscoveryMessage["language"],
    profileState?: DiscoveryProfileState,
  ): Promise<DiscoveryMessage> {
    const message = await this.completeConversationTurn(
      sessionId,
      ["researching"],
      "in_progress",
      content,
      undefined,
      {
        role: "assistant",
        content,
        language,
        source: "chat",
      },
      profileState,
    );

    if (!message) {
      throw new Error("Initial discovery question was not persisted.");
    }

    return message;
  }

  async getIntake(sessionId: string): Promise<PreparedDiscoveryIntakeDto> {
    const intake = await this.prisma.preparedDiscoveryIntake.findUnique({
      where: { sessionId },
    });

    if (!intake) {
      throw new NotFoundException("Discovery intake not found");
    }

    return {
      business_name: intake.businessName,
      business_type: intake.businessType,
      city: intake.city,
      area: intake.area ?? undefined,
      address_text: intake.addressText ?? undefined,
      owner_goal_text: intake.ownerGoalText ?? undefined,
      known_competitors_text: intake.knownCompetitorsText ?? undefined,
      target_audience_text: intake.targetAudienceText ?? undefined,
      notes: intake.notes ?? undefined,
    };
  }

  async confirmProfile(
    ownerUserId: string,
    sessionId: string,
    profileDraftId: string,
    intake: PreparedDiscoveryIntakeDto,
    acknowledgeIncomplete = false,
  ): Promise<ConfirmProfileResponse> {
    const version = await this.prisma.$transaction(async (tx) => {
      const session = await tx.discoverySession.findFirst({
        where: { id: sessionId, ownerUserId },
        include: { businessProfileDrafts: { where: { id: profileDraftId } } },
      });

      const draft = session?.businessProfileDrafts[0];
      if (!session || !draft) {
        throw new NotFoundException("Profile draft not found");
      }
      if (session.status === "confirmed") {
        if (
          session.profileDraftId !== profileDraftId ||
          !session.confirmedProfileVersionId
        ) {
          throw new ConflictException(
            "Discovery session was confirmed with a different profile draft",
          );
        }

        const existingVersion = await tx.businessProfileVersion.findUnique({
          where: { id: session.confirmedProfileVersionId },
        });
        if (!existingVersion) {
          throw new ConflictException(
            "Confirmed profile version is not available",
          );
        }
        return existingVersion;
      }
      if (draft.completeness === "incomplete" && !acknowledgeIncomplete) {
        throw new BadRequestException(
          "Incomplete profile acknowledgement is required",
        );
      }

      if (
        session.status !== "summary_ready" ||
        session.profileDraftId !== profileDraftId
      ) {
        throw invalidDiscoveryState();
      }

      const claim = await tx.discoverySession.updateMany({
        where: {
          id: sessionId,
          ownerUserId,
          status: "summary_ready",
          profileDraftId,
        },
        data: { status: "confirmed" },
      });
      if (claim.count !== 1) {
        const confirmedSession = await tx.discoverySession.findFirst({
          where: { id: sessionId, ownerUserId },
        });
        if (
          confirmedSession?.status === "confirmed" &&
          confirmedSession.profileDraftId === profileDraftId &&
          confirmedSession.confirmedProfileVersionId
        ) {
          const existingVersion = await tx.businessProfileVersion.findUnique({
            where: { id: confirmedSession.confirmedProfileVersionId },
          });
          if (existingVersion) {
            return existingVersion;
          }
        }
        throw invalidDiscoveryState();
      }

      const businessId =
        session.businessId ??
        (
          await tx.business.create({
            data: {
              ownerUserId,
              displayName: intake.business_name,
              businessType: intake.business_type,
              city: intake.city,
              area: intake.area,
              addressText: intake.address_text,
              primaryLocale: session.languageMode,
              status: "active",
            },
          })
        ).id;

      const latestVersion = await tx.businessProfileVersion.aggregate({
        where: { businessId },
        _max: { version: true },
      });
      const nextVersion = (latestVersion._max.version ?? 0) + 1;
      const confirmedDraft = profileDraftFromPersistence(draft);
      const savedVersion = await tx.businessProfileVersion.create({
        data: {
          businessId,
          draftId: draft.id,
          version: nextVersion,
          profile: jsonForPrisma({
            business_name: intake.business_name,
            business_type: intake.business_type,
            city: intake.city,
            ...(intake.area === undefined ? {} : { area: intake.area }),
            ...(intake.address_text === undefined
              ? {}
              : { address_text: intake.address_text }),
            primary_locale: session.languageMode,
            confirmed_facts: confirmedDraft.confirmed_facts,
            completeness: confirmedDraft.completeness,
            completion_reason: confirmedDraft.completion_reason,
            readiness: confirmedDraft.readiness,
            market_context: confirmedDraft.market_context,
            research_observations: confirmedDraft.research_observations,
            uncertainties: confirmedDraft.uncertainties,
            owner_goals: confirmedDraft.owner_goals,
            strategy_relevant_notes: confirmedDraft.strategy_relevant_notes,
          }),
          confirmedByUserId: ownerUserId,
        },
      });

      await tx.businessProfileDraft.update({
        where: { id: draft.id },
        data: { businessId, status: "confirmed" },
      });
      await tx.discoverySession.update({
        where: { id: sessionId },
        data: {
          businessId,
          status: "confirmed",
          profileDraftId: draft.id,
          confirmedProfileVersionId: savedVersion.id,
          completedAt: savedVersion.confirmedAt,
        },
      });

      return savedVersion;
    });

    return {
      session_id: sessionId,
      status: "confirmed",
      business_profile_version_id: version.id,
      confirmed_at: version.confirmedAt.toISOString(),
      strategy_locked: false,
    };
  }
}

function profileDraftCreateData(draft: BusinessProfileDraft) {
  return {
    id: draft.id,
    sessionId: draft.session_id,
    version: draft.version,
    status: draft.status,
    completeness: draft.completeness,
    completionReason: draft.completion_reason,
    readiness: jsonForPrisma(draft.readiness),
    confirmedFacts: jsonForPrisma(draft.confirmed_facts),
    researchObservations: jsonForPrismaArray(draft.research_observations),
    uncertainties: jsonForPrismaArray(draft.uncertainties),
    ownerGoals: jsonForPrismaArray(draft.owner_goals),
    strategyRelevantNotes: jsonForPrismaArray(draft.strategy_relevant_notes),
    rawAiOutput: jsonForPrisma(draft.raw_ai_output),
  };
}

function profileDraftUpdateData(draft: BusinessProfileDraft) {
  return {
    status: draft.status,
    completeness: draft.completeness,
    completionReason: draft.completion_reason,
    readiness: jsonForPrisma(draft.readiness),
    confirmedFacts: jsonForPrisma(draft.confirmed_facts),
    researchObservations: jsonForPrismaArray(draft.research_observations),
    uncertainties: jsonForPrismaArray(draft.uncertainties),
    ownerGoals: jsonForPrismaArray(draft.owner_goals),
    strategyRelevantNotes: jsonForPrismaArray(draft.strategy_relevant_notes),
    rawAiOutput: jsonForPrisma(draft.raw_ai_output),
  };
}

function jsonForPrisma(value: object): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function jsonForPrismaArray(value: readonly unknown[]): Prisma.InputJsonArray {
  return [...value] as Prisma.InputJsonArray;
}

function invalidDiscoveryState(): ConflictException {
  return new ConflictException(
    "Discovery session is not in a valid state for this action",
  );
}
