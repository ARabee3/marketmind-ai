import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../../common/config/external-provider.config";
import { ProviderError } from "../../../../common/errors/provider-error";
import { ApifyActorClient } from "../apify/apify-actor.client";
import type { SearchResultCandidate } from "../search-result.types";
import { normalizeFacebookPageResults } from "./facebook-result.normalizer";

@Injectable()
export class ApifyFacebookPagesProvider {
  constructor(private readonly actorClient: ApifyActorClient) {}

  async enrich(
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    const config = externalProviderConfig().facebook;
    const response = await this.actorClient.runDatasetItems(
      {
        actorId: config.pageActorId,
        input: { startUrls: [{ url: pageUrl }] },
        maxItems: Math.min(config.maxPages, 1),
        maxTotalChargeUsd: Math.min(
          config.maxPageChargeUsd,
          config.maxSessionChargeUsd,
          0.02,
        ),
        timeoutMs: Math.min(config.timeoutMs, 60_000),
      },
      signal,
    );
    if (!Array.isArray(response)) {
      throw new ProviderError(
        "APIFY_FACEBOOK_INVALID_OUTPUT",
        "Facebook Page actor returned invalid output.",
        false,
      );
    }
    const results = normalizeFacebookPageResults(
      response,
      pageUrl,
      config.pageActorId,
    );
    if (results.length === 0) {
      throw new ProviderError(
        "APIFY_FACEBOOK_RESTRICTED_OR_EMPTY",
        "The public Facebook Page was empty or restricted.",
        false,
      );
    }
    return results;
  }
}
