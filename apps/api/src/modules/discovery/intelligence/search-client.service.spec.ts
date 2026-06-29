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

  it("uses SerpApi results first", async () => {
    serpApi.search.mockResolvedValue([serpResult]);

    await expect(service.search("koshary cairo")).resolves.toEqual([
      serpResult,
    ]);
    expect(duckDuckGo.search).not.toHaveBeenCalled();
  });

  it("uses Apify Maps first when requested by provider hints", async () => {
    apifyMaps.search.mockResolvedValue([mapsResult]);

    await expect(
      service.search("koshary cairo", ["apify_google_maps", "serpapi"]),
    ).resolves.toEqual([mapsResult]);
    expect(serpApi.search).not.toHaveBeenCalled();
  });

  it("falls back to SerpApi when Apify Maps is unavailable", async () => {
    apifyMaps.search.mockRejectedValue(
      new ProviderError("APIFY_NOT_CONFIGURED", "Missing token.", false),
    );
    serpApi.search.mockResolvedValue([serpResult]);

    await expect(
      service.search("koshary cairo", ["apify_google_maps", "serpapi"]),
    ).resolves.toEqual([serpResult]);
  });

  it("falls back to DuckDuckGo when SerpApi is unavailable", async () => {
    serpApi.search.mockRejectedValue(
      new ProviderError("SERPAPI_NOT_CONFIGURED", "Missing key.", false),
    );
    duckDuckGo.search.mockResolvedValue([duckResult]);

    await expect(service.search("koshary cairo")).resolves.toEqual([
      duckResult,
    ]);
  });

  it("falls back to DuckDuckGo when SerpApi returns no results", async () => {
    serpApi.search.mockResolvedValue([]);
    duckDuckGo.search.mockResolvedValue([duckResult]);

    await expect(service.search("koshary cairo")).resolves.toEqual([
      duckResult,
    ]);
  });
});
