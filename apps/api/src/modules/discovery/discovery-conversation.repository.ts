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
  DiscoveryReadiness,
  DiscoverySessionStatus,
  MarketAwareBusinessFacts,
} from "./discovery-state";
import {
  messageFromPersistence,
  profileDraftFromPersistence,
} from "./discovery-conversation.mapper";
import {
  PreparedDiscoveryIntakeDto,
  SocialPlatformDto,
} from "./dto/start-discovery.dto";

type MessageInput = {
  readonly id?: string;
  readonly role: DiscoveryMessage["role"];
  readonly content: string;
  readonly language: DiscoveryMessage["language"];
  readonly source: DiscoveryMessage["source"];
  readonly metadata?: Record<string, unknown>;
  readonly created_at?: string;
};

type ConfirmationCorrections = {
  readonly confirmed_facts: MarketAwareBusinessFacts;
  readonly readiness: DiscoveryReadiness;
  readonly completeness: BusinessProfileDraft["completeness"];
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

    const committedMessages = [...messages];
    while (committedMessages.at(-1)?.role === "owner") {
      committedMessages.pop();
    }

    return committedMessages.map(messageFromPersistence);
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
    ownerMessage?: MessageInput,
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

      if (ownerMessage) {
        await deleteTrailingOwnerMessages(tx, sessionId);
        await tx.discoveryMessage.create({
          data: messageCreateData(sessionId, ownerMessage),
        });
      }

      return tx.discoveryMessage.create({
        data: messageCreateData(sessionId, assistantMessage),
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
    ownerMessage?: MessageInput,
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

      if (ownerMessage) {
        await deleteTrailingOwnerMessages(tx, sessionId);
        await tx.discoveryMessage.create({
          data: messageCreateData(sessionId, ownerMessage),
        });
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
        data: messageCreateData(sessionId, assistantMessage),
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
    metadata?: Record<string, unknown>,
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
        metadata,
      },
      profileState,
    );

    if (!message) {
      throw new Error("Initial discovery question was not persisted.");
    }

    return message;
  }

  async getIntake(sessionId: string): Promise<PreparedDiscoveryIntakeDto> {
    const [intake, socialLinks] = await Promise.all([
      this.prisma.preparedDiscoveryIntake.findUnique({
        where: { sessionId },
      }),
      this.prisma.socialLink.findMany({
        where: { sessionId, ownerSubmitted: true },
        orderBy: { createdAt: "asc" },
        select: { platform: true, url: true },
      }),
    ]);

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
      social_links: socialLinks.flatMap((link) => {
        const platform = socialPlatformFromPersistence(link.platform);
        return platform ? [{ platform, url: link.url }] : [];
      }),
    };
  }

  async confirmProfile(
    ownerUserId: string,
    sessionId: string,
    profileDraftId: string,
    intake: PreparedDiscoveryIntakeDto,
    acknowledgeIncomplete = false,
    corrections?: ConfirmationCorrections,
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

      const confirmedDraft = profileDraftFromPersistence(draft);
      const confirmedFacts =
        corrections?.confirmed_facts ?? confirmedDraft.confirmed_facts;
      const readiness = corrections?.readiness ?? confirmedDraft.readiness;
      const completeness =
        corrections?.completeness ?? confirmedDraft.completeness;
      const identity = confirmedIdentity(confirmedFacts, intake);
      let businessId = session.businessId;
      if (businessId) {
        await tx.business.update({
          where: { id: businessId },
          data: {
            displayName: identity.business_name,
            businessType: identity.business_type,
            city: identity.city,
            area: identity.area,
          },
        });
      } else {
        const created = await tx.business.create({
          data: {
            ownerUserId,
            displayName: identity.business_name,
            businessType: identity.business_type,
            city: identity.city,
            area: identity.area,
            addressText: intake.address_text,
            primaryLocale: session.languageMode,
            status: "active",
          },
        });
        businessId = created.id;
      }

      const latestVersion = await tx.businessProfileVersion.aggregate({
        where: { businessId },
        _max: { version: true },
      });
      const nextVersion = (latestVersion._max.version ?? 0) + 1;
      const savedVersion = await tx.businessProfileVersion.create({
        data: {
          businessId,
          draftId: draft.id,
          version: nextVersion,
          profile: jsonForPrisma({
            business_name: identity.business_name,
            business_type: identity.business_type,
            city: identity.city,
            ...(identity.area ? { area: identity.area } : {}),
            ...(intake.address_text === undefined
              ? {}
              : { address_text: intake.address_text }),
            primary_locale: session.languageMode,
            confirmed_facts: confirmedFacts,
            completeness,
            completion_reason: confirmedDraft.completion_reason,
            readiness,
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
        data: {
          businessId,
          status: "confirmed",
          ...(corrections
            ? {
                confirmedFacts: jsonForPrisma(confirmedFacts),
                readiness: jsonForPrisma(readiness),
              }
            : {}),
        },
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

function socialPlatformFromPersistence(
  platform: string,
): SocialPlatformDto | null {
  switch (platform) {
    case SocialPlatformDto.Facebook:
    case SocialPlatformDto.Instagram:
    case SocialPlatformDto.Tiktok:
    case SocialPlatformDto.Website:
    case SocialPlatformDto.GoogleMaps:
    case SocialPlatformDto.Delivery:
    case SocialPlatformDto.Other:
      return platform;
    default:
      return null;
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

function messageCreateData(sessionId: string, message: MessageInput) {
  return {
    ...(message.id ? { id: message.id } : {}),
    sessionId,
    role: message.role,
    content: message.content,
    language: message.language,
    source: message.source,
    metadata: jsonForPrisma(message.metadata ?? {}),
    ...(message.created_at ? { createdAt: new Date(message.created_at) } : {}),
  };
}

async function deleteTrailingOwnerMessages(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<void> {
  const latestAssistant = await tx.discoveryMessage.findFirst({
    where: { sessionId, role: "assistant" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  await tx.discoveryMessage.deleteMany({
    where: {
      sessionId,
      role: "owner",
      ...(latestAssistant
        ? { createdAt: { gt: latestAssistant.createdAt } }
        : {}),
    },
  });
}

function jsonForPrisma(value: object): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function jsonForPrismaArray(value: readonly unknown[]): Prisma.InputJsonArray {
  return [...value] as Prisma.InputJsonArray;
}

/**
 * Identity used for the confirmed `Business` entity and the version profile's
 * top-level identity fields. Prefers the confirmed facts the owner reviewed
 * (including any edits applied at confirm time) and only falls back to the
 * original intake when a value is empty, so every downstream surface reads the
 * last-confirmed data.
 */
function confirmedIdentity(
  confirmedFacts: MarketAwareBusinessFacts,
  intake: PreparedDiscoveryIntakeDto,
): {
  business_name: string;
  business_type: string;
  city: string;
  area: string | undefined;
} {
  const identity = confirmedFacts.identity;
  return {
    business_name:
      pick(identity.business_name, intake.business_name) ??
      intake.business_name,
    business_type:
      pick(identity.business_type, intake.business_type) ??
      intake.business_type,
    city: pick(identity.city, intake.city) ?? intake.city,
    area: pick(identity.area, intake.area),
  };
}

function pick(
  value: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function invalidDiscoveryState(): ConflictException {
  return new ConflictException(
    "Discovery session is not in a valid state for this action",
  );
}
