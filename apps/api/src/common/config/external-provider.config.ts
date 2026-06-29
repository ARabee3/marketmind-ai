export type ExternalProviderConfig = {
  readonly aiServiceBaseUrl?: string;
  readonly serpApiKey?: string;
  readonly apifyToken?: string;
  readonly discoverySearchTimeoutMs: number;
};

export function externalProviderConfig(): ExternalProviderConfig {
  return {
    aiServiceBaseUrl: process.env.AI_SERVICE_BASE_URL,
    serpApiKey: process.env.SERPAPI_KEY,
    apifyToken: process.env.APIFY_TOKEN,
    discoverySearchTimeoutMs: parseInt(
      process.env.DISCOVERY_SEARCH_TIMEOUT_MS ?? "8000",
      10,
    ),
  };
}
