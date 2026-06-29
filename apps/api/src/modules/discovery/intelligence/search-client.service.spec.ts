import { ProviderError } from "../../../common/errors/provider-error";
import { DuckDuckGoSearchProvider } from "./duckduckgo-search.provider";
import { SearchClientService } from "./search-client.service";
import { SearchResultCandidate } from "./search-result.types";
import { SerpApiSearchProvider } from "./serpapi-search.provider";

describe("SearchClientService", () => {
  const serpApi = {
    search: jest.fn(),
  } as unknown as jest.Mocked<SerpApiSearchProvider>;
  const duckDuckGo = {
    search: jest.fn(),
  } as unknown as jest.Mocked<DuckDuckGoSearchProvider>;
  const service = new SearchClientService(serpApi, duckDuckGo);
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
