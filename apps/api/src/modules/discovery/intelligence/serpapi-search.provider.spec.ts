import { SerpApiSearchProvider } from "./serpapi-search.provider";

describe("SerpApiSearchProvider", () => {
  const originalEnv = process.env;
  const fetchMock = jest.spyOn(global, "fetch");

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SERPAPI_KEY: "serp-key",
      DISCOVERY_SEARCH_TIMEOUT_MS: "8000",
    };
    fetchMock.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
    fetchMock.mockRestore();
  });

  it("calls SerpApi Google search and normalizes organic results", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            title: "Koshary Corner",
            link: "https://example.com/koshary",
            snippet: "Restaurant in Cairo",
            position: 1,
          },
        ],
      }),
    } as Response);

    const results = await new SerpApiSearchProvider().search("koshary cairo");

    expect(results).toEqual([
      {
        provider: "serpapi",
        title: "Koshary Corner",
        url: "https://example.com/koshary",
        snippet: "Restaurant in Cairo",
        rank: 1,
        query: "koshary cairo",
        confidence: 1,
        metadata: { engine: "google" },
      },
    ]);
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get("engine")).toBe("google");
    expect(calledUrl.searchParams.get("q")).toBe("koshary cairo");
    expect(calledUrl.searchParams.get("gl")).toBe("eg");
  });
});
