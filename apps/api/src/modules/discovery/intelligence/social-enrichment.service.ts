import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import {
  SocialPlatformDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";
import { ApifyFacebookPagesProvider } from "./facebook/apify-facebook-pages.provider";
import { ApifyFacebookPostsProvider } from "./facebook/apify-facebook-posts.provider";
import { normalizeFacebookPageUrl } from "./facebook/facebook-url";
import type { ResearchProviderName } from "./query-plan.types";
import type { SearchResultCandidate } from "./search-result.types";
import type {
  SocialEnrichmentAttempt,
  SocialEnrichmentResult,
} from "./social-enrichment.types";

type FacebookProviderName = Extract<
  ResearchProviderName,
  "apify_facebook_pages" | "apify_facebook_posts"
>;

type ProviderResult = {
  readonly candidates: readonly SearchResultCandidate[];
  readonly attempt: SocialEnrichmentAttempt;
  readonly warning?: SocialEnrichmentResult["provider_warnings"][number];
};

@Injectable()
export class SocialEnrichmentService {
  constructor(
    private readonly pagesProvider: ApifyFacebookPagesProvider,
    private readonly postsProvider: ApifyFacebookPostsProvider,
  ) {}

  isEnabledFor(dto: StartDiscoveryDto): boolean {
    return (
      externalProviderConfig().facebook.enrichmentEnabled &&
      Boolean(
        dto.intake.social_links?.some(
          (link) => link.platform === SocialPlatformDto.Facebook,
        ),
      )
    );
  }

  async enrich(
    dto: StartDiscoveryDto,
    signal?: AbortSignal,
  ): Promise<SocialEnrichmentResult> {
    const config = externalProviderConfig().facebook;
    if (!this.isEnabledFor(dto)) {
      return emptyResult();
    }

    const submittedUrl = dto.intake.social_links?.find(
      (link) => link.platform === SocialPlatformDto.Facebook,
    )?.url;
    if (!submittedUrl) {
      return emptyResult();
    }

    const pageUrl = normalizeFacebookPageUrl(submittedUrl);
    if (!pageUrl) {
      return {
        candidates: [],
        provider_attempts: [],
        provider_warnings: [
          {
            code: "APIFY_FACEBOOK_INVALID_PAGE_URL",
            message:
              "The submitted Facebook link is not a supported public Page URL.",
            retryable: false,
          },
        ],
      };
    }

    const calls = [
      this.callProvider(
        "apify_facebook_pages",
        () => this.pagesProvider.enrich(pageUrl, signal),
        signal,
      ),
    ];
    if (config.postsEnabled) {
      calls.push(
        this.callProvider(
          "apify_facebook_posts",
          () => this.postsProvider.enrich(pageUrl, signal),
          signal,
        ),
      );
    }

    const results = await Promise.all(calls);
    return {
      candidates: results.flatMap((result) => result.candidates),
      provider_attempts: results.map((result) => result.attempt),
      provider_warnings: results.flatMap((result) =>
        result.warning ? [result.warning] : [],
      ),
    };
  }

  private async callProvider(
    provider: FacebookProviderName,
    call: () => Promise<readonly SearchResultCandidate[]>,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    const startedAt = Date.now();
    try {
      const candidates = await call();
      return {
        candidates,
        attempt: {
          provider,
          outcome: candidates.length > 0 ? "succeeded" : "empty",
          result_count: candidates.length,
          duration_ms: Date.now() - startedAt,
        },
      };
    } catch (error) {
      signal?.throwIfAborted();
      const normalized = facebookProviderError(error);
      return {
        candidates: [],
        warning: normalized,
        attempt: {
          provider,
          outcome: "failed",
          result_count: 0,
          duration_ms: Date.now() - startedAt,
          error_code: normalized.code,
        },
      };
    }
  }
}

function emptyResult(): SocialEnrichmentResult {
  return { candidates: [], provider_attempts: [], provider_warnings: [] };
}

function facebookProviderError(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
} {
  if (!(error instanceof ProviderError)) {
    return {
      code: "APIFY_FACEBOOK_PROVIDER_ERROR",
      message: "Facebook enrichment failed.",
      retryable: true,
    };
  }

  const codeByProviderCode: Readonly<Record<string, string>> = {
    APIFY_NOT_CONFIGURED: "APIFY_FACEBOOK_NOT_CONFIGURED",
    APIFY_ACTOR_TIMEOUT: "APIFY_FACEBOOK_TIMEOUT",
    APIFY_ACTOR_RATE_LIMITED: "APIFY_FACEBOOK_RATE_LIMITED",
    APIFY_ACTOR_BUDGET_EXHAUSTED: "APIFY_FACEBOOK_BUDGET_EXHAUSTED",
    APIFY_ACTOR_INVALID_OUTPUT: "APIFY_FACEBOOK_INVALID_OUTPUT",
    EXTERNAL_REQUEST_TIMEOUT: "APIFY_FACEBOOK_TIMEOUT",
    EXTERNAL_RESPONSE_TOO_LARGE: "APIFY_FACEBOOK_INVALID_OUTPUT",
    APIFY_FACEBOOK_INVALID_OUTPUT: "APIFY_FACEBOOK_INVALID_OUTPUT",
    APIFY_FACEBOOK_RESTRICTED_OR_EMPTY:
      "APIFY_FACEBOOK_RESTRICTED_OR_EMPTY",
  };
  return {
    code: codeByProviderCode[error.code] ?? "APIFY_FACEBOOK_PROVIDER_ERROR",
    message: "Facebook enrichment failed.",
    retryable: error.retryable,
  };
}
