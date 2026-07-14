import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../../common/config/external-provider.config";
import { ApifyActorClient } from "../apify/apify-actor.client";
import type { SearchResultCandidate } from "../search-result.types";
import { normalizeFacebookPostResults } from "./facebook-result.normalizer";

@Injectable()
export class ApifyFacebookPostsProvider {
  constructor(private readonly actorClient: ApifyActorClient) {}

  async enrich(
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    const config = externalProviderConfig().facebook;
    const maxPosts = Math.min(config.maxPosts, 5);
    const response = await this.actorClient.runDatasetItems(
      {
        actorId: config.postActorId,
        input: {
          startUrls: [{ url: pageUrl }],
          resultsLimit: maxPosts,
          captionText: false,
        },
        maxItems: maxPosts,
        maxTotalChargeUsd: Math.min(
          config.maxPostChargeUsd,
          config.maxSessionChargeUsd,
          0.03,
        ),
        timeoutMs: Math.min(config.timeoutMs, 60_000),
      },
      signal,
    );
    return normalizeFacebookPostResults(
      response,
      pageUrl,
      config.postActorId,
      maxPosts,
    );
  }
}
