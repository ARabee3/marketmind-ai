export type ExternalProviderConfig = {
  readonly aiServiceBaseUrl?: string;
  readonly serpApiKey?: string;
  readonly apifyToken?: string;
  readonly discoverySearchTimeoutMs: number;
  readonly aiRequestTimeoutMs: number;
  readonly aiProviderRetryDelayMs: number;
  readonly discoveryResearchTimeoutMs: number;
  readonly discoveryTriageTimeoutMs: number;
  readonly facebook: FacebookEnrichmentConfig;
};

export type FacebookEnrichmentConfig = {
  readonly enrichmentEnabled: boolean;
  readonly postsEnabled: boolean;
  readonly pageActorId: string;
  readonly postActorId: string;
  readonly maxPages: number;
  readonly maxPosts: number;
  readonly timeoutMs: number;
  readonly maxSessionChargeUsd: number;
  readonly maxPageChargeUsd: number;
  readonly maxPostChargeUsd: number;
};

export const DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS = 8000;
export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_AI_PROVIDER_RETRY_DELAY_MS = 3000;
export const DEFAULT_DISCOVERY_RESEARCH_TIMEOUT_MS = 180_000;
export const DEFAULT_DISCOVERY_TRIAGE_TIMEOUT_MS = 120_000;

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
    aiRequestTimeoutMs: positiveIntegerEnv(
      process.env.AI_REQUEST_TIMEOUT_MS,
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
    ),
    aiProviderRetryDelayMs: positiveIntegerEnv(
      process.env.AI_PROVIDER_RETRY_DELAY_MS,
      DEFAULT_AI_PROVIDER_RETRY_DELAY_MS,
    ),
    discoveryResearchTimeoutMs: positiveIntegerEnv(
      process.env.DISCOVERY_RESEARCH_TIMEOUT_MS,
      DEFAULT_DISCOVERY_RESEARCH_TIMEOUT_MS,
    ),
    discoveryTriageTimeoutMs: positiveIntegerEnv(
      process.env.DISCOVERY_TRIAGE_TIMEOUT_MS,
      DEFAULT_DISCOVERY_TRIAGE_TIMEOUT_MS,
    ),
    facebook: {
      enrichmentEnabled: booleanEnv(
        process.env.DISCOVERY_FACEBOOK_ENRICHMENT_ENABLED,
      ),
      postsEnabled: booleanEnv(process.env.DISCOVERY_FACEBOOK_POSTS_ENABLED),
      pageActorId:
        process.env.APIFY_FACEBOOK_PAGES_ACTOR_ID ??
        "apify~facebook-pages-scraper",
      postActorId:
        process.env.APIFY_FACEBOOK_POSTS_ACTOR_ID ??
        "apify~facebook-posts-scraper",
      maxPages: positiveIntegerEnv(process.env.DISCOVERY_FACEBOOK_MAX_PAGES, 1),
      maxPosts: positiveIntegerEnv(process.env.DISCOVERY_FACEBOOK_MAX_POSTS, 5),
      timeoutMs: positiveIntegerEnv(
        process.env.DISCOVERY_FACEBOOK_TIMEOUT_MS,
        60_000,
      ),
      maxSessionChargeUsd: positiveNumberEnv(
        process.env.DISCOVERY_FACEBOOK_SESSION_MAX_CHARGE_USD,
        0.05,
      ),
      maxPageChargeUsd: positiveNumberEnv(
        process.env.DISCOVERY_FACEBOOK_PAGES_MAX_CHARGE_USD,
        0.02,
      ),
      maxPostChargeUsd: positiveNumberEnv(
        process.env.DISCOVERY_FACEBOOK_POSTS_MAX_CHARGE_USD,
        0.03,
      ),
    },
  };
}

function booleanEnv(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function positiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumberEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseFloat(value ?? "");

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
