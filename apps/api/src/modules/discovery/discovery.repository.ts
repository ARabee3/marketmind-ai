import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  DiscoveryProgressEvent,
  DiscoveryProgressInput,
  IntelligenceResult,
} from "./discovery-state";
import {
  intelligenceFromPersistence,
  metadataForPrisma,
} from "./discovery-persistence.mapper";
import { progressEventsFromPersistence } from "./discovery-progress.mapper";
import {
  StartDiscoveryDto,
  SocialLinkInputDto,
} from "./dto/start-discovery.dto";

type DiscoverySessionWithIntake = {
  id: string;
  status: string;
  languageMode: string;
  currentQuestion: string | null;
  startedAt: Date;
  intakes: Array<{
    businessName: string;
    businessType: string;
    city: string;
    area: string | null;
  }>;
  progressEvents: Array<{
    seq: number;
    stage: string;
    status: string;
    messageKey: string;
    messageText: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
  }>;
  intelligence: IntelligenceResult;
};

@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPreparedSession(ownerUserId: string, dto: StartDiscoveryDto) {
    const languageMode = dto.language_mode ?? "mixed";

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.discoverySession.create({
        data: {
          ownerUserId,
          status: "researching",
          languageMode,
        },
      });

      await tx.preparedDiscoveryIntake.create({
        data: {
          sessionId: session.id,
          businessName: dto.intake.business_name,
          businessType: dto.intake.business_type,
          city: dto.intake.city,
          area: dto.intake.area,
          addressText: dto.intake.address_text,
          ownerGoalText: dto.intake.owner_goal_text,
          knownCompetitorsText: dto.intake.known_competitors_text,
          targetAudienceText: dto.intake.target_audience_text,
          notes: dto.intake.notes,
          rawPayload: dto.intake as never,
        },
      });

      await this.createSocialLinks(
        tx,
        session.id,
        dto.intake.social_links ?? [],
      );

      return session;
    });
  }

  async findSessionForOwner(
    ownerUserId: string,
    sessionId: string,
  ): Promise<DiscoverySessionWithIntake> {
    const session = await this.prisma.discoverySession.findFirst({
      where: {
        id: sessionId,
        ownerUserId,
      },
      include: {
        intelligenceRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            status: true,
            searchMode: true,
            errorCode: true,
            errorMessage: true,
          },
        },
        intakes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            businessName: true,
            businessType: true,
            city: true,
            area: true,
          },
        },
        sourceRefs: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            sourceType: true,
            platform: true,
            url: true,
            title: true,
            snippet: true,
            fetchedAt: true,
            confidence: true,
            metadata: true,
          },
        },
        researchObservations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            sourceRefId: true,
            kind: true,
            statement: true,
            confidence: true,
            visibility: true,
            status: true,
            discardReason: true,
            metadata: true,
          },
        },
        conversationHooks: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            sourceObservationId: true,
            hookText: true,
            language: true,
            status: true,
          },
        },
        knowledgeGaps: {
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            fieldKey: true,
            questionHint: true,
            priority: true,
            status: true,
          },
        },
        discoveryProgressEvents: {
          orderBy: { seq: "asc" },
          select: {
            seq: true,
            stage: true,
            status: true,
            messageKey: true,
            messageText: true,
            payload: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException("Discovery session not found");
    }

    return {
      ...session,
      intelligence: intelligenceFromPersistence(session),
      progressEvents: session.discoveryProgressEvents,
    };
  }

  async updateCurrentQuestion(
    sessionId: string,
    currentQuestion: string,
  ): Promise<void> {
    await this.prisma.discoverySession.update({
      where: { id: sessionId },
      data: {
        currentQuestion,
        status: "in_progress",
      },
    });
  }

  async updateStatus(sessionId: string, status: string): Promise<void> {
    await this.prisma.discoverySession.update({
      where: { id: sessionId },
      data: { status },
    });
  }

  async appendProgressEvent(
    sessionId: string,
    event: DiscoveryProgressInput,
  ): Promise<DiscoveryProgressEvent> {
    const savedEvent = await this.prisma.$transaction(async (tx) => {
      const seq = await tx.discoveryProgressEvent.count({
        where: { sessionId },
      });

      return tx.discoveryProgressEvent.create({
        data: {
          sessionId,
          seq: seq + 1,
          stage: event.stage,
          status: event.status,
          messageKey: event.messageKey,
          messageText: event.messageText,
          payload: metadataForPrisma(event.payload ?? {}),
        },
      });
    });

    const progressEvent = progressEventsFromPersistence([savedEvent])[0];
    if (!progressEvent) {
      throw new Error("Progress event was not persisted.");
    }

    return progressEvent;
  }

  private async createSocialLinks(
    tx: Prisma.TransactionClient,
    sessionId: string,
    links: SocialLinkInputDto[],
  ): Promise<void> {
    if (links.length === 0) {
      return;
    }

    await tx.socialLink.createMany({
      data: links.map((link) => ({
        sessionId,
        platform: link.platform,
        url: link.url,
        ownerSubmitted: true,
        status: "pending",
      })),
      skipDuplicates: true,
    });
  }
}
