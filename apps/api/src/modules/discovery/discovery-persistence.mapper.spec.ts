import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { intelligenceFromPersistence } from "./discovery-persistence.mapper";

describe("discovery persistence mapper", () => {
  it("maps persisted intelligence rows into the API contract", () => {
    const result = intelligenceFromPersistence({
      intelligenceRuns: [
        {
          status: "complete",
          searchMode: "free_search",
          errorCode: null,
          errorMessage: null,
        },
      ],
      sourceRefs: [
        {
          id: "source-db-id",
          sourceType: "search_result",
          platform: "serpapi",
          url: "https://example.com",
          title: "Koshary Corner",
          snippet: "Restaurant in Cairo",
          fetchedAt: new Date("2026-06-29T10:00:00.000Z"),
          confidence: new Prisma.Decimal("0.91"),
          metadata: { provider: "serpapi" },
        },
      ],
      researchObservations: [
        {
          id: "observation-db-id",
          sourceRefId: "source-db-id",
          kind: "competitor",
          statement: "Popular nearby competitor.",
          confidence: new Prisma.Decimal("0.88"),
          visibility: "owner_visible",
          status: "accepted",
          discardReason: null,
          metadata: { rank: 1 },
        },
      ],
      conversationHooks: [],
      knowledgeGaps: [],
    });

    expect(result).toEqual({
      status: "complete",
      search_mode: "free_search",
      source_refs: [
        {
          id: "source-db-id",
          source_type: "search_result",
          platform: "serpapi",
          url: "https://example.com",
          title: "Koshary Corner",
          snippet: "Restaurant in Cairo",
          fetched_at: "2026-06-29T10:00:00.000Z",
          confidence: 0.91,
          metadata: { provider: "serpapi" },
        },
      ],
      research_observations: [
        {
          id: "observation-db-id",
          source_ref_id: "source-db-id",
          kind: "competitor",
          statement: "Popular nearby competitor.",
          confidence: 0.88,
          visibility: "owner_visible",
          status: "accepted",
          discard_reason: undefined,
          metadata: { rank: 1 },
        },
      ],
      conversation_hooks: [],
      knowledge_gaps: [],
      safe_error: undefined,
    });
  });

});
