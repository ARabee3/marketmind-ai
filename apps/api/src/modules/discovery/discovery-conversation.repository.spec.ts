import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { profileStateFromPersistence } from "./discovery-conversation.mapper";
import { LanguageModeDto } from "./dto/start-discovery.dto";
import {
  emptyDiscoveryProfileState,
  emptyMarketAwareBusinessFacts,
} from "./market-profile";

describe("DiscoveryConversationRepository", () => {
  it("recovers persisted readiness, turn count, and completion reason", () => {
    const persisted = emptyDiscoveryProfileState();
    const recovered = profileStateFromPersistence(
      persisted as never,
      15,
      "turn_limit",
    );

    expect(recovered.readiness).toMatchObject({
      owner_turn_count: 15,
      completion_reason: "turn_limit",
    });
  });

  it("stores the initial assistant question with its state transition", async () => {
    const prisma = transactionPrisma({
      discoverySession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      discoveryMessage: {
        create: jest.fn().mockResolvedValue({
          id: "message-id",
          role: "assistant",
          content: "Who are your best current customers?",
          language: "mixed",
          source: "chat",
          createdAt: new Date("2026-06-29T10:01:00.000Z"),
        }),
      },
    });
    const repository = new DiscoveryConversationRepository(prisma as never);

    const message = await repository.recordInitialAssistantQuestion(
      "session-id",
      "Who are your best current customers?",
      LanguageModeDto.Mixed,
    );

    expect(message.role).toBe("assistant");
    expect(prisma.tx.discoverySession.updateMany).toHaveBeenCalledWith({
      where: {
        id: "session-id",
        status: {
          in: ["partial_ready", "ready_for_chat", "research_failed"],
        },
      },
      data: {
        status: "in_progress",
        currentQuestion: "Who are your best current customers?",
        profileDraftId: undefined,
      },
    });
    expect(prisma.tx.discoveryMessage.create).toHaveBeenCalledTimes(1);
  });

  it("does not store a question after a conflicting transition", async () => {
    const prisma = transactionPrisma({
      discoverySession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      discoveryMessage: {
        create: jest.fn(),
      },
    });
    const repository = new DiscoveryConversationRepository(prisma as never);

    await expect(
      repository.recordInitialAssistantQuestion(
        "session-id",
        "Question",
        LanguageModeDto.Mixed,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tx.discoveryMessage.create).not.toHaveBeenCalled();
  });

  it("returns the existing confirmed version for an identical retry", async () => {
    const confirmedAt = new Date("2026-06-29T10:10:00.000Z");
    const tx = {
      discoverySession: {
        findFirst: jest.fn().mockResolvedValue({
          status: "confirmed",
          profileDraftId: "draft-id",
          confirmedProfileVersionId: "version-id",
          businessProfileDrafts: [
            { id: "draft-id", completeness: "incomplete" },
          ],
        }),
      },
      businessProfileVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-id",
          confirmedAt,
        }),
        create: jest.fn(),
      },
    };
    const prisma = transactionPrisma(tx);
    const repository = new DiscoveryConversationRepository(prisma as never);

    const result = await repository.confirmProfile(
      "owner-id",
      "session-id",
      "draft-id",
      intake(),
    );

    expect(result.business_profile_version_id).toBe("version-id");
    expect(tx.businessProfileVersion.create).not.toHaveBeenCalled();
  });

  it("copies identity, research, and uncertainties into the confirmed snapshot", async () => {
    const confirmedAt = new Date("2026-06-29T10:10:00.000Z");
    const tx = {
      discoverySession: {
        findFirst: jest.fn().mockResolvedValue({
          status: "summary_ready",
          profileDraftId: "draft-id",
          confirmedProfileVersionId: null,
          businessId: "business-id",
          languageMode: "mixed",
          businessProfileDrafts: [
            {
              id: "draft-id",
              completeness: "complete",
              completionReason: "sufficient",
              confirmedFacts: {
                ...emptyMarketAwareBusinessFacts(),
                identity: {
                  business_name: "Koshary Corner",
                  business_type: "restaurant",
                  city: "Cairo",
                  area: "Nasr City",
                },
              },
              researchObservations: [
                {
                  id: "observation-1",
                  source_ref_id: "source-1",
                  kind: "competitor",
                  statement: "A nearby restaurant appears in local search.",
                  confidence: 0.8,
                  visibility: "owner_visible",
                  status: "accepted",
                  metadata: {},
                },
              ],
              uncertainties: [
                {
                  domain: "goals_and_constraints",
                  field_key: "budget",
                  description: "Budget is unknown.",
                  severity: "medium",
                  category: "owner_unknown",
                  source: "owner_unknown",
                  resolved: false,
                },
              ],
              ownerGoals: ["grow delivery"],
              strategyRelevantNotes: ["family bundles"],
            },
          ],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      businessProfileVersion: {
        aggregate: jest.fn().mockResolvedValue({ _max: { version: 2 } }),
        create: jest.fn().mockResolvedValue({
          id: "version-id",
          confirmedAt,
        }),
      },
      businessProfileDraft: {
        update: jest.fn(),
      },
      business: {
        create: jest.fn(),
      },
    };
    const prisma = transactionPrisma(tx);
    const repository = new DiscoveryConversationRepository(prisma as never);

    await repository.confirmProfile(
      "owner-id",
      "session-id",
      "draft-id",
      intake(),
    );

    expect(tx.businessProfileVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 3,
        profile: expect.objectContaining({
          business_name: "Koshary Corner",
          primary_locale: "mixed",
          market_context: expect.objectContaining({
            competitor_landscape: [
              expect.objectContaining({ observation_id: "observation-1" }),
            ],
          }),
          research_observations: [
            expect.objectContaining({ id: "observation-1" }),
          ],
          uncertainties: [
            expect.objectContaining({ field_key: "budget", resolved: false }),
          ],
        }),
      }),
    });
  });

  it("requires acknowledgement before confirming an incomplete draft", async () => {
    const tx = {
      discoverySession: {
        findFirst: jest.fn().mockResolvedValue({
          status: "summary_ready",
          profileDraftId: "draft-id",
          businessProfileDrafts: [
            { id: "draft-id", completeness: "incomplete" },
          ],
        }),
      },
    };
    const repository = new DiscoveryConversationRepository(
      transactionPrisma(tx) as never,
    );

    await expect(
      repository.confirmProfile(
        "owner-id",
        "session-id",
        "draft-id",
        intake(),
        false,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function transactionPrisma<T extends object>(tx: T): PrismaService & { tx: T } {
  return {
    tx,
    $transaction: jest.fn((callback) => callback(tx)),
  } as unknown as PrismaService & { tx: T };
}

function intake() {
  return {
    business_name: "Koshary Corner",
    business_type: "restaurant",
    city: "Cairo",
    area: "Nasr City",
  };
}
