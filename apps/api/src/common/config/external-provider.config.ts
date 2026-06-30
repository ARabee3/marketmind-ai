export type ExternalProviderConfig = {
  readonly aiServiceBaseUrl?: string;
  readonly serpApiKey?: string;
  readonly apifyToken?: string;
  readonly discoverySearchTimeoutMs: number;
};

export const DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS = 8000;

export function externalProviderConfig(): ExternalProviderConfig {
  return {
    aiServiceBaseUrl: process.env.AI_SERVICE_BASE_URL,
    serpApiKey: process.env.SERPAPI_KEY,
    apifyToken:
      process.env.APIFY_TOKEN ??
      process.env.APIFY_API_KEY ??
      process.env.Apify_API_KEY,
    discoverySearchTimeoutMs: positiveIntegerEnv(
      process.env.DISCOVERY_SEARCH_TIMEOUT_MS,
      DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS,
    ),
  };
}

function positiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
