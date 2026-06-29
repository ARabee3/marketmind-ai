import { ApifyMapsProvider } from "./apify-maps.provider";

describe("ApifyMapsProvider", () => {
  const originalEnv = process.env;
  const fetchMock = jest.spyOn(global, "fetch");

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APIFY_TOKEN: "apify-token",
      DISCOVERY_SEARCH_TIMEOUT_MS: "8000",
    };
    fetchMock.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
    fetchMock.mockRestore();
  });

  it("runs the Google Maps actor and normalizes place results", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          title: "Koshary Corner",
          address: "Nasr City, Cairo",
          phone: "01000000000",
          averageRating: 4.5,
          placeId: "place-1",
        },
      ],
    } as Response);

    const results = await new ApifyMapsProvider().search("koshary cairo");

    expect(results).toEqual([
      {
        provider: "apify_google_maps",
        title: "Koshary Corner",
        url: "maps://placeid/place-1",
        snippet: "Nasr City, Cairo · tel: 01000000000 · rating: 4.5",
        rank: 1,
        query: "koshary cairo",
        confidence: 0.9,
        metadata: {
          provider: "apify_google_maps",
          address: "Nasr City, Cairo",
          phone: "01000000000",
          rating: 4.5,
          place_id: "place-1",
        },
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/actors/nwua9Gu5YrADL7ZDj/run-sync-get-dataset-items",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          searchStringsArray: ["koshary cairo"],
          maxCrawledPlacesPerSearch: 5,
          language: "ar",
        }),
      }),
    );
  });
});
