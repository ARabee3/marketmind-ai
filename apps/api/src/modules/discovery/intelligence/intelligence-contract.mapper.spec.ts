import "reflect-metadata";
import { LanguageModeDto } from "../dto/start-discovery.dto";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";

describe("IntelligenceContractMapper", () => {
  const mapper = new IntelligenceContractMapper();

  it("maps provider sources into contract-safe search results", () => {
    const result = mapper.toIntelligenceResult({
      status: "complete",
      source_refs: [
        {
          source_type: "serpapi",
          url: "https://example.com/koshary",
          title: "Koshary Corner",
          snippet: "Koshary restaurant in Nasr City",
          confidence: 0.86,
        },
      ],
      research_observations: [
        {
          kind: "digital_presence",
          statement: "Found an active listing.",
          source_index: 0,
          confidence: 0.84,
          visibility: "owner_visible",
        },
      ],
      conversation_hooks: [
        {
          source_observation_index: 0,
          hook_text: "Is this your official listing?",
          language: LanguageModeDto.English,
        },
      ],
      knowledge_gaps: [
        {
          field_key: "peak_hours",
          question_hint: "What are your peak hours?",
          priority: 1,
        },
      ],
    });

    expect(result.search_mode).toBe("free_search");
    expect(result.source_refs[0]).toMatchObject({
      id: "source_ref_1",
      source_type: "search_result",
      metadata: { provider: "serpapi" },
    });
    expect(result.research_observations[0]).toMatchObject({
      id: "observation_1",
      source_ref_id: "source_ref_1",
      status: "accepted",
    });
    expect(result.conversation_hooks[0]).toMatchObject({
      id: "hook_1",
      source_observation_id: "observation_1",
      hook_text: "Is this your official listing?",
    });
    expect(result.knowledge_gaps[0]).toMatchObject({
      id: "knowledge_gap_1",
      question_hint: "What are your peak hours?",
      status: "open",
    });
  });

  it("uses discarded status instead of a fake observation kind", () => {
    const result = mapper.toIntelligenceResult({
      status: "partial",
      source_refs: [
        {
          source_type: "apify",
          url: "https://maps.example/wrong-place",
          title: "Wrong place",
          snippet: "Restaurant in another city",
          confidence: 0.2,
        },
      ],
      research_observations: [
        {
          kind: "discarded",
          statement: "Discarded source: city mismatch.",
          source_index: 0,
          confidence: 0,
          status: "discarded",
          discard_reason: "City mismatch.",
        },
      ],
    });

    expect(result.research_observations[0]).toMatchObject({
      kind: "metadata",
      status: "discarded",
      discard_reason: "City mismatch.",
      metadata: { original_kind: "discarded" },
    });
  });

  it("keeps metadata-only results metadata-only", () => {
    const result = mapper.toIntelligenceResult({
      status: "partial",
      source_refs: [
        {
          source_type: "metadata",
          platform: "instagram",
          url: "https://instagram.example/koshary",
          confidence: 0.7,
        },
      ],
    });

    expect(result.search_mode).toBe("metadata_only");
    expect(result.source_refs[0].source_type).toBe("metadata");
    expect(result.source_refs[0].metadata).toEqual({});
  });
});
