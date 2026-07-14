import { ApifyActorClient } from "../apify/apify-actor.client";
import { ApifyFacebookPagesProvider } from "./apify-facebook-pages.provider";
import { ApifyFacebookPostsProvider } from "./apify-facebook-posts.provider";

describe("Apify Facebook providers", () => {
  const originalEnv = process.env;
  const fetchMock = jest.spyOn(global, "fetch");
  const pageUrl = "https://facebook.com/kasrnapoly";

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APIFY_TOKEN: "test-token",
      DISCOVERY_FACEBOOK_MAX_POSTS: "5",
    };
    fetchMock.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
    fetchMock.mockRestore();
  });

  it("requests one Page with the Page charge cap", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ pageName: "قصر نابولي" }]), {
        status: 200,
      }),
    );

    const result = await new ApifyFacebookPagesProvider(
      new ApifyActorClient(),
    ).enrich(pageUrl);

    expect(result).toHaveLength(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("maxItems")).toBe("1");
    expect(requestUrl.searchParams.get("maxTotalChargeUsd")).toBe("0.02");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      startUrls: [{ url: pageUrl }],
    });
  });

  it("requests at most five posts without video transcripts", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(
          Array.from({ length: 6 }, (_, index) => ({
            postId: `p-${index}`,
            postUrl: `${pageUrl}/posts/${index}`,
            text: `post ${index}`,
          })),
        ),
        { status: 200 },
      ),
    );

    const result = await new ApifyFacebookPostsProvider(
      new ApifyActorClient(),
    ).enrich(pageUrl);

    expect(result).toHaveLength(5);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("maxItems")).toBe("5");
    expect(requestUrl.searchParams.get("maxTotalChargeUsd")).toBe("0.03");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      startUrls: [{ url: pageUrl }],
      resultsLimit: 5,
      captionText: false,
    });
  });

  it("reports an empty or restricted Page distinctly", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));

    await expect(
      new ApifyFacebookPagesProvider(new ApifyActorClient()).enrich(pageUrl),
    ).rejects.toMatchObject({
      code: "APIFY_FACEBOOK_RESTRICTED_OR_EMPTY",
      retryable: false,
    });
  });
});
