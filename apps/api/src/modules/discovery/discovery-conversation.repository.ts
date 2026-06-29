import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  BusinessProfileDraft,
  ConfirmProfileResponse,
  DiscoveryMessage,
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

  async listMessages(sessionId: string): Promise<readonly DiscoveryMessage[]> {
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
        confirmedFacts: jsonForPrisma(draft.confirmed_facts),
        researchObservations: jsonForPrismaArray(draft.research_observations),
        uncertainties: jsonForPrismaArray(draft.uncertainties),
        ownerGoals: jsonForPrismaArray(draft.owner_goals),
        strategyRelevantNotes: jsonForPrismaArray(draft.strategy_relevant_notes),
        rawAiOutput: jsonForPrisma(draft.raw_ai_output),
      },
      update: {
        status: draft.status,
        confirmedFacts: jsonForPrisma(draft.confirmed_facts),
        researchObservations: jsonForPrismaArray(draft.research_observations),
        uncertainties: jsonForPrismaArray(draft.uncertainties),
        ownerGoals: jsonForPrismaArray(draft.owner_goals),
        strategyRelevantNotes: jsonForPrismaArray(draft.strategy_relevant_notes),
        rawAiOutput: jsonForPrisma(draft.raw_ai_output),
      },
    });

    return profileDraftFromPersistence(saved);
  }

  async updateSessionConversationState(
    sessionId: string,
    status: "in_progress" | "summary_ready",
    currentQuestion?: string,
    profileDraftId?: string,
  ): Promise<void> {
    await this.prisma.discoverySession.update({
      where: { id: sessionId },
      data: {
        status,
        currentQuestion,
        profileDraftId,
      },
    });
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

      const nextVersion =
        (await tx.businessProfileVersion.count({ where: { businessId } })) + 1;
      const savedVersion = await tx.businessProfileVersion.create({
        data: {
          businessId,
          draftId: draft.id,
          version: nextVersion,
          profile: jsonForPrisma({
            confirmed_facts: draft.confirmedFacts,
            owner_goals: draft.ownerGoals,
            strategy_relevant_notes: draft.strategyRelevantNotes,
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

function jsonForPrisma(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function jsonForPrismaArray(value: readonly unknown[]): Prisma.InputJsonArray {
  return [...value] as Prisma.InputJsonArray;
}
