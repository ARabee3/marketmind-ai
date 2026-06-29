import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import { StartDiscoveryDto, SocialLinkInputDto } from "./dto/start-discovery.dto";

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

      await this.createSocialLinks(tx, session.id, dto.intake.social_links ?? []);

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
      },
    });

    if (!session) {
      throw new NotFoundException("Discovery session not found");
    }

    return session;
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
