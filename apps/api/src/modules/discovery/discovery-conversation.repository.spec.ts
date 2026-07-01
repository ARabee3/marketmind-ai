import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { LanguageModeDto } from "./dto/start-discovery.dto";

describe("DiscoveryConversationRepository", () => {
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
          businessProfileDrafts: [{ id: "draft-id" }],
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
              confirmedFacts: { audience: "families" },
              researchObservations: [{ id: "observation-1" }],
              uncertainties: [{ field_key: "budget", resolved: false }],
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
          research_observations: [{ id: "observation-1" }],
          uncertainties: [{ field_key: "budget", resolved: false }],
        }),
      }),
    });
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
