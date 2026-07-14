import { IntelligenceSourceConsolidator } from "./intelligence-source.consolidator";

describe("IntelligenceSourceConsolidator", () => {
  it("keeps the owner-link type, merges richer Facebook evidence, and remaps observations", () => {
    const service = new IntelligenceSourceConsolidator();

    const result = service.consolidate(
      [
        {
          source_type: "owner_link",
          platform: "facebook",
          url: "https://www.facebook.com/kasrnapoly/?ref=owner",
          confidence: 0.45,
          metadata: { owner_submitted: true, metadata_fetch_status: "failed" },
        },
        {
          source_type: "search_result",
          platform: "apify_facebook_pages",
          url: "https://facebook.com/kasrnapoly",
          title: "قصر نابولي",
          snippet: "حلويات ومخبوزات في أسيوط",
          confidence: 0.91,
          metadata: {
            provider: "apify_facebook_pages",
            followers_count: 8500,
          },
        },
        {
          source_type: "search_result",
          platform: "apify_facebook_posts",
          url: "https://facebook.com/kasrnapoly/posts/1",
          title: "Facebook post 1",
          confidence: 0.8,
        },
      ],
      [
        {
          kind: "social_signal",
          statement: "Owner link",
          source_index: 0,
          confidence: 0.45,
        },
        {
          kind: "social_signal",
          statement: "Facebook Page match",
          source_index: 1,
          confidence: 0.91,
        },
        {
          kind: "social_signal",
          statement: "Recent Facebook post",
          source_index: 2,
          confidence: 0.8,
        },
      ],
    );

    expect(result.source_refs).toHaveLength(2);
    expect(result.source_refs[0]).toMatchObject({
      source_type: "owner_link",
      platform: "facebook",
      title: "قصر نابولي",
      snippet: "حلويات ومخبوزات في أسيوط",
      confidence: 0.91,
      metadata: {
        owner_submitted: true,
        provider: "apify_facebook_pages",
        followers_count: 8500,
      },
    });
    expect(
      result.research_observations.map((item) => item.source_index),
    ).toEqual([0, 0, 1]);
  });
});
