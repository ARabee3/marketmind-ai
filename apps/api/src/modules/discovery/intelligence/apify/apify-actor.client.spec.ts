import { ProviderError } from "../../../../common/errors/provider-error";
import { ApifyActorClient } from "./apify-actor.client";

describe("ApifyActorClient", () => {
  const originalEnv = process.env;
  const fetchMock = jest.spyOn(global, "fetch");

  beforeEach(() => {
    process.env = { ...originalEnv, APIFY_TOKEN: "test-token" };
    fetchMock.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
    fetchMock.mockRestore();
  });

  it("runs a synchronous actor with hard item, time, and charge caps", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ pageName: "Kasr Napoli" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await new ApifyActorClient().runDatasetItems({
      actorId: "apify~facebook-pages-scraper",
      input: { startUrls: [{ url: "https://facebook.com/kasrnapoly" }] },
      maxItems: 1,
      maxTotalChargeUsd: 0.02,
      timeoutMs: 60_000,
    });

    expect(result).toEqual([{ pageName: "Kasr Napoli" }]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe(
      "/v2/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items",
    );
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      clean: "true",
      maxItems: "1",
      maxTotalChargeUsd: "0.02",
      timeout: "60",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("fails before a request when Apify is not configured", async () => {
    delete process.env.APIFY_TOKEN;
    delete process.env.APIFY_API_KEY;
    delete process.env.Apify_API_KEY;

    await expect(
      new ApifyActorClient().runDatasetItems({
        actorId: "apify~facebook-pages-scraper",
        input: {},
        maxItems: 1,
        maxTotalChargeUsd: 0.02,
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject<Partial<ProviderError>>({
      code: "APIFY_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry when the Apify budget is exhausted", async () => {
    fetchMock.mockResolvedValue(new Response("budget exhausted", { status: 402 }));

    await expect(
      new ApifyActorClient().runDatasetItems({
        actorId: "apify~facebook-pages-scraper",
        input: {},
        maxItems: 1,
        maxTotalChargeUsd: 0.02,
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject<Partial<ProviderError>>({
      code: "APIFY_ACTOR_BUDGET_EXHAUSTED",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports transient failure as retryable without starting another actor run", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      new ApifyActorClient().runDatasetItems({
        actorId: "apify~facebook-pages-scraper",
        input: {},
        maxItems: 1,
        maxTotalChargeUsd: 0.02,
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject<Partial<ProviderError>>({
      code: "APIFY_ACTOR_ERROR",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
