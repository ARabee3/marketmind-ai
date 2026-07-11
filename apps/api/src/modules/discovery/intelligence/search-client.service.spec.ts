import { ProviderError } from "../../../common/errors/provider-error";
import { ApifyMapsProvider } from "./apify-maps.provider";
import { DuckDuckGoSearchProvider } from "./duckduckgo-search.provider";
import { SearchClientService } from "./search-client.service";
import { SearchResultCandidate } from "./search-result.types";
import { SerpApiSearchProvider } from "./serpapi-search.provider";

describe("SearchClientService", () => {
  const serpApi = {
    search: jest.fn(),
  } as unknown as jest.Mocked<SerpApiSearchProvider>;
  const apifyMaps = {
    search: jest.fn(),
  } as unknown as jest.Mocked<ApifyMapsProvider>;
  const duckDuckGo = {
    search: jest.fn(),
  } as unknown as jest.Mocked<DuckDuckGoSearchProvider>;
  const service = new SearchClientService(apifyMaps, serpApi, duckDuckGo);
  const serpResult: SearchResultCandidate = {
    provider: "serpapi",
    title: "Koshary Corner",
    url: "https://example.com/koshary",
    snippet: "Restaurant in Cairo",
    rank: 1,
    query: "koshary cairo",
    confidence: 1,
  };
  const duckResult: SearchResultCandidate = {
    provider: "duckduckgo",
    snippet: "Fallback result",
    rank: 1,
    query: "koshary cairo",
    confidence: 0.6,
  };
  const mapsResult: SearchResultCandidate = {
    provider: "apify_google_maps",
    title: "Koshary Competitor",
    url: "maps://placeid/abc",
    snippet: "Nasr City, Cairo",
    rank: 1,
    query: "koshary cairo",
    confidence: 0.9,
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("respects provider hint order before Apify Maps fallback", async () => {
    serpApi.search.mockResolvedValue([]);
    apifyMaps.search.mockResolvedValue([mapsResult]);

    await expect(
      service.search("koshary cairo", [
        "serpapi",
        "apify_google_maps",
        "duckduckgo",
      ]),
    ).resolves.toMatchObject({
      results: [mapsResult],
      provider_attempts: [
        { provider: "serpapi", outcome: "empty", result_count: 0 },
        {
          provider: "apify_google_maps",
          outcome: "succeeded",
          result_count: 1,
        },
      ],
    });
    expect(
      serpApi.search.mock.invocationCallOrder[0],
    ).toBeLessThan(apifyMaps.search.mock.invocationCallOrder[0]);
    expect(duckDuckGo.search).not.toHaveBeenCalled();
  });

  it("uses SerpApi results first", async () => {
    serpApi.search.mockResolvedValue([serpResult]);

    await expect(service.search("koshary cairo")).resolves.toEqual({
      results: [serpResult],
      provider_warnings: [],
      provider_attempts: [
        { provider: "serpapi", outcome: "succeeded", result_count: 1 },
      ],
    });
    expect(duckDuckGo.search).not.toHaveBeenCalled();
  });

  it("uses Apify Maps first when requested by provider hints", async () => {
    apifyMaps.search.mockResolvedValue([mapsResult]);

    await expect(
      service.search("koshary cairo", ["apify_google_maps", "serpapi"]),
    ).resolves.toEqual({
      results: [mapsResult],
      provider_warnings: [],
      provider_attempts: [
        {
          provider: "apify_google_maps",
          outcome: "succeeded",
          result_count: 1,
        },
      ],
    });
    expect(serpApi.search).not.toHaveBeenCalled();
  });

  it("deduplicates provider hints without changing order", async () => {
    serpApi.search.mockResolvedValue([]);
    duckDuckGo.search.mockResolvedValue([duckResult]);

    await expect(
      service.search("koshary cairo", ["serpapi", "serpapi", "duckduckgo"]),
    ).resolves.toMatchObject({
      results: [duckResult],
      provider_attempts: [
        { provider: "serpapi", outcome: "empty", result_count: 0 },
        { provider: "duckduckgo", outcome: "succeeded", result_count: 1 },
      ],
    });
    expect(serpApi.search).toHaveBeenCalledTimes(1);
  });

  it("skips metadata-only hints without network search", async () => {
    await expect(service.search("koshary cairo", ["metadata"])).resolves.toEqual({
      results: [],
      provider_warnings: [],
      provider_attempts: [],
    });
    expect(serpApi.search).not.toHaveBeenCalled();
    expect(apifyMaps.search).not.toHaveBeenCalled();
    expect(duckDuckGo.search).not.toHaveBeenCalled();
  });

  it("honors an aborted signal before network search", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.search("koshary cairo", ["serpapi"], abortController.signal),
    ).rejects.toThrow();
    expect(serpApi.search).not.toHaveBeenCalled();
  });

  it("falls back to SerpApi when Apify Maps is unavailable", async () => {
    apifyMaps.search.mockRejectedValue(
      new ProviderError("APIFY_NOT_CONFIGURED", "Missing token.", false),
    );
    serpApi.search.mockResolvedValue([serpResult]);

    await expect(
      service.search("koshary cairo", ["apify_google_maps", "serpapi"]),
    ).resolves.toMatchObject({
      results: [serpResult],
      provider_warnings: [{ code: "APIFY_NOT_CONFIGURED" }],
      provider_attempts: [
        {
          provider: "apify_google_maps",
          outcome: "failed",
          result_count: 0,
          error_code: "APIFY_NOT_CONFIGURED",
        },
        { provider: "serpapi", outcome: "succeeded", result_count: 1 },
      ],
    });
  });

  it("falls back to DuckDuckGo when SerpApi is unavailable", async () => {
    serpApi.search.mockRejectedValue(
      new ProviderError("SERPAPI_NOT_CONFIGURED", "Missing key.", false),
    );
    duckDuckGo.search.mockResolvedValue([duckResult]);

    await expect(service.search("koshary cairo")).resolves.toMatchObject({
      results: [duckResult],
      provider_warnings: [{ code: "SERPAPI_NOT_CONFIGURED" }],
      provider_attempts: [
        {
          provider: "serpapi",
          outcome: "failed",
          result_count: 0,
          error_code: "SERPAPI_NOT_CONFIGURED",
        },
        { provider: "duckduckgo", outcome: "succeeded", result_count: 1 },
      ],
    });
  });

  it("falls back to DuckDuckGo when SerpApi returns no results", async () => {
    serpApi.search.mockResolvedValue([]);
    duckDuckGo.search.mockResolvedValue([duckResult]);

    await expect(service.search("koshary cairo")).resolves.toEqual({
      results: [duckResult],
      provider_warnings: [],
      provider_attempts: [
        { provider: "serpapi", outcome: "empty", result_count: 0 },
        { provider: "duckduckgo", outcome: "succeeded", result_count: 1 },
      ],
    });
  });

  it("does not add default fallbacks after an explicit provider fails", async () => {
    apifyMaps.search.mockRejectedValue(
      new ProviderError("APIFY_MAPS_ERROR", "Maps failed.", true),
    );
    serpApi.search.mockRejectedValue(
      new ProviderError("SERPAPI_SEARCH_FAILED", "SerpApi failed.", true),
    );
    duckDuckGo.search.mockResolvedValue([duckResult]);

    await expect(
      service.search("koshary cairo", ["apify_google_maps"]),
    ).resolves.toEqual({
      results: [],
      provider_warnings: [
        { code: "APIFY_MAPS_ERROR", message: "Maps failed.", retryable: true },
      ],
      provider_attempts: [
        {
          provider: "apify_google_maps",
          outcome: "failed",
          result_count: 0,
          error_code: "APIFY_MAPS_ERROR",
        },
      ],
    });
    expect(serpApi.search).not.toHaveBeenCalled();
    expect(duckDuckGo.search).not.toHaveBeenCalled();
  });
});
