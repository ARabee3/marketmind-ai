import { Injectable, NotFoundException } from "@nestjs/common";
import type { DiscoverySessionStatus } from "@marketmind/contracts";
import { PrismaService } from "../../common/persistence/prisma.service";
import type { DiscoveryProfileState } from "../discovery/discovery-state";
import { profileStateFromPersistence } from "../discovery/discovery-conversation.mapper";

type StoredJourneySessionStatus = Exclude<
  DiscoverySessionStatus,
  "not_started"
>;

export type JourneyOwnerRecord = {
  readonly id: string;
  readonly fullName: string | null;
  readonly email: string;
  readonly isEmailVerified: boolean;
};

export type JourneyIntakeRecord = {
  readonly businessName: string;
  readonly businessType: string;
  readonly city: string;
  readonly area: string | null;
};

export type JourneyConfirmedProfileRecord = {
  readonly id: string;
  readonly businessId: string;
  readonly version: number;
  readonly confirmedAt: Date;
  readonly business: {
    readonly displayName: string;
    readonly businessType: string;
    readonly city: string;
    readonly area: string | null;
  };
};

export type JourneySessionRecord = {
  readonly id: string;
  readonly status: StoredJourneySessionStatus;
  readonly languageMode: string;
  readonly profileState: DiscoveryProfileState;
  readonly ownerTurnCount: number;
  readonly profileDraftId: string | null;
  readonly confirmedProfileVersionId: string | null;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly intake: JourneyIntakeRecord | null;
  readonly confirmedProfile: JourneyConfirmedProfileRecord | null;
};

export type JourneyCurrentRecord = {
  readonly owner: JourneyOwnerRecord;
  readonly session: JourneySessionRecord | null;
};

export interface JourneyRepositoryPort {
  findCurrentForOwner(ownerUserId: string): Promise<JourneyCurrentRecord>;
}

@Injectable()
export class JourneyRepository implements JourneyRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findCurrentForOwner(ownerUserId: string): Promise<JourneyCurrentRecord> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
      select: {
        id: true,
        fullName: true,
        email: true,
        isEmailVerified: true,
      },
    });

    if (!owner) {
      throw new NotFoundException("Owner not found");
    }

    const session = await this.prisma.discoverySession.findFirst({
      where: {
        ownerUserId,
        status: { not: "not_started" },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        languageMode: true,
        profileState: true,
        ownerTurnCount: true,
        completionReason: true,
        profileDraftId: true,
        confirmedProfileVersionId: true,
        updatedAt: true,
        completedAt: true,
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
      return { owner, session: null };
    }

    const confirmedProfile = session.confirmedProfileVersionId
      ? await this.prisma.businessProfileVersion.findUnique({
          where: { id: session.confirmedProfileVersionId },
          select: {
            id: true,
            businessId: true,
            version: true,
            confirmedAt: true,
            business: {
              select: {
                displayName: true,
                businessType: true,
                city: true,
                area: true,
              },
            },
          },
        })
      : null;

    return {
      owner,
      session: {
        id: session.id,
        status: discoveryStatus(session.status),
        languageMode: session.languageMode,
        profileState: profileStateFromPersistence(
          session.profileState,
          session.ownerTurnCount,
          session.completionReason,
        ),
        ownerTurnCount: session.ownerTurnCount,
        profileDraftId: session.profileDraftId,
        confirmedProfileVersionId: session.confirmedProfileVersionId,
        updatedAt: session.updatedAt,
        completedAt: session.completedAt,
        intake: session.intakes[0] ?? null,
        confirmedProfile,
      },
    };
  }
}

function discoveryStatus(value: string): StoredJourneySessionStatus {
  switch (value) {
    case "researching":
    case "partial_ready":
    case "ready_for_chat":
    case "in_progress":
    case "summary_ready":
    case "confirmed":
    case "research_failed":
    case "failed":
    case "cancelled":
      return value;
    case "not_started":
    default:
      return "failed";
  }
}
