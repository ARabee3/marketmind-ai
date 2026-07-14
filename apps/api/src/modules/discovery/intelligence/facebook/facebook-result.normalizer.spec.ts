import {
  normalizeFacebookPageResults,
  normalizeFacebookPostResults,
} from "./facebook-result.normalizer";

describe("Facebook result normalizer", () => {
  const pageUrl = "https://facebook.com/kasrnapoly";

  it("keeps only bounded public Page business fields", () => {
    const result = normalizeFacebookPageResults(
      [
        {
          pageId: "123",
          pageName: "قصر نابولي",
          facebookUrl: pageUrl,
          categories: ["Dessert Shop", "Bakery"],
          intro: "حلويات ومخبوزات في أسيوط",
          address: "شارع النميس، أسيوط",
          website: "https://kasrnapoly.example",
          followers: 8500,
          likes: 8100,
          rating: 4.6,
          adminProfiles: [{ id: "private-person" }],
          rawPayload: { secret: true },
        },
      ],
      pageUrl,
      "apify/facebook-pages-scraper",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "apify_facebook_pages",
      title: "قصر نابولي",
      url: pageUrl,
      rank: 1,
      metadata: {
        provider: "apify_facebook_pages",
        actor_id: "apify/facebook-pages-scraper",
        facebook_page_id: "123",
        categories_text: "Dessert Shop, Bakery",
        followers_count: 8500,
        likes_count: 8100,
        rating: 4.6,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-person");
    expect(JSON.stringify(result)).not.toContain("rawPayload");
  });

  it("caps posts at five and excludes identity-level and raw fields", () => {
    const response = Array.from({ length: 7 }, (_, index) => ({
      postId: `post-${index + 1}`,
      postUrl: `${pageUrl}/posts/${index + 1}`,
      text: `عرض رقم ${index + 1}`,
      timestamp: "2026-07-01T10:00:00Z",
      reactions: 20 + index,
      comments: 3,
      shares: 2,
      commentsData: [{ authorName: "private-person" }],
    }));

    const result = normalizeFacebookPostResults(
      response,
      pageUrl,
      "apify/facebook-posts-scraper",
      5,
    );

    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({
      provider: "apify_facebook_posts",
      url: `${pageUrl}/posts/1`,
      snippet: "عرض رقم 1",
      metadata: {
        facebook_post_id: "post-1",
        reactions_count: 20,
        comments_count: 3,
        shares_count: 2,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-person");
  });

  it("drops malformed actor items", () => {
    expect(
      normalizeFacebookPageResults([null, "bad", {}], pageUrl, "actor"),
    ).toEqual([]);
    expect(
      normalizeFacebookPostResults([null, "bad", {}], pageUrl, "actor", 5),
    ).toEqual([]);
  });
});
