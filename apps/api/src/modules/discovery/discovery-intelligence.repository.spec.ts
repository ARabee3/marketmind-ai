import { PrismaService } from "../../common/persistence/prisma.service";
import { IntelligenceResult } from "./discovery-state";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";

describe("DiscoveryIntelligenceRepository", () => {
  it("deduplicates source URLs within one intelligence run", async () => {
    const prisma = prismaMock();
    const repository = new DiscoveryIntelligenceRepository(prisma as never);

    await repository.saveIntelligenceResult(
      "session-id",
      duplicateIntelligence(),
    );

    expect(prisma.sourceRef.create).toHaveBeenCalledTimes(1);
  });

  it("maps duplicate source ids to the first saved source", async () => {
    const prisma = prismaMock();
    const repository = new DiscoveryIntelligenceRepository(prisma as never);

    await repository.saveIntelligenceResult(
      "session-id",
      duplicateIntelligence(),
    );

    expect(prisma.researchObservation.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ sourceRefId: "saved-source-id" }),
      }),
    );
    expect(prisma.researchObservation.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ sourceRefId: "saved-source-id" }),
      }),
    );
  });
});

function prismaMock(): PrismaService {
  const tx = {
    intelligenceRun: {
      create: jest.fn().mockResolvedValue({ id: "run-id" }),
    },
    sourceRef: {
      create: jest.fn().mockResolvedValue({ id: "saved-source-id" }),
    },
    researchObservation: {
      create: jest
        .fn()
        .mockResolvedValueOnce({ id: "saved-observation-1" })
        .mockResolvedValueOnce({ id: "saved-observation-2" }),
    },
    conversationHook: {
      createMany: jest.fn(),
    },
    knowledgeGap: {
      createMany: jest.fn(),
    },
    discoverySession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  return {
    ...tx,
    $transaction: jest.fn((callback) => callback(tx)),
  } as unknown as PrismaService;
}

function duplicateIntelligence(): IntelligenceResult {
  return {
    status: "complete",
    search_mode: "free_search",
    source_refs: [
      {
        id: "source_ref_1",
        source_type: "search_result",
        url: "https://Example.com/path/",
        confidence: 0.8,
        metadata: {},
      },
      {
        id: "source_ref_2",
        source_type: "search_result",
        url: "https://example.com/path#section",
        confidence: 0.7,
        metadata: {},
      },
    ],
    research_observations: [
      {
        id: "observation_1",
        source_ref_id: "source_ref_1",
        kind: "digital_presence",
        statement: "First",
        confidence: 0.8,
        visibility: "internal",
        status: "accepted",
        metadata: {},
      },
      {
        id: "observation_2",
        source_ref_id: "source_ref_2",
        kind: "digital_presence",
        statement: "Second",
        confidence: 0.7,
        visibility: "internal",
        status: "accepted",
        metadata: {},
      },
    ],
    conversation_hooks: [],
    knowledge_gaps: [],
  };
}
