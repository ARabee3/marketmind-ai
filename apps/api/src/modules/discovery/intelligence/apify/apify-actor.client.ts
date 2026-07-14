import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../../common/config/external-provider.config";
import { ProviderError } from "../../../../common/errors/provider-error";
import { postExternalJson } from "../../../../common/http/external-http-client";

const APIFY_RESPONSE_MAX_BYTES = 512 * 1024;

export type ApifyActorRequest = {
  readonly actorId: string;
  readonly input: Record<string, unknown>;
  readonly maxItems: number;
  readonly maxTotalChargeUsd?: number;
  readonly timeoutMs: number;
};

@Injectable()
export class ApifyActorClient {
  async runDatasetItems(
    request: ApifyActorRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const token = externalProviderConfig().apifyToken;
    if (!token) {
      throw new ProviderError(
        "APIFY_NOT_CONFIGURED",
        "APIFY_TOKEN is not configured.",
        false,
      );
    }

    const actorId = encodeURIComponent(request.actorId);
    const url = new URL(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`,
    );
    url.searchParams.set("clean", "true");
    url.searchParams.set("maxItems", String(request.maxItems));
    if (request.maxTotalChargeUsd !== undefined) {
      url.searchParams.set(
        "maxTotalChargeUsd",
        String(request.maxTotalChargeUsd),
      );
    }
    url.searchParams.set(
      "timeout",
      String(Math.ceil(request.timeoutMs / 1000)),
    );

    try {
      return await postExternalJson<unknown>(url.toString(), request.input, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: request.timeoutMs,
        maxBodyBytes: APIFY_RESPONSE_MAX_BYTES,
        signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      throw apifyActorError(error);
    }
  }
}

function apifyActorError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ProviderError(
      "APIFY_ACTOR_TIMEOUT",
      "Apify actor request timed out.",
      true,
    );
  }

  const message = error instanceof Error ? error.message : "";
  const status = Number.parseInt(
    message.match(/External request failed with (\d{3})/)?.[1] ?? "",
    10,
  );
  if (status === 402) {
    return new ProviderError(
      "APIFY_ACTOR_BUDGET_EXHAUSTED",
      "Apify actor budget is exhausted.",
      false,
    );
  }
  if (status === 429) {
    return new ProviderError(
      "APIFY_ACTOR_RATE_LIMITED",
      "Apify actor request was rate limited.",
      true,
    );
  }
  if (status >= 400 && status < 500) {
    return new ProviderError(
      "APIFY_ACTOR_REQUEST_REJECTED",
      "Apify actor rejected the request.",
      false,
    );
  }
  if (message.startsWith("External response exceeded")) {
    return new ProviderError(
      "APIFY_ACTOR_INVALID_OUTPUT",
      "Apify actor output exceeded the response limit.",
      false,
    );
  }
  return new ProviderError(
    "APIFY_ACTOR_ERROR",
    "Apify actor request failed.",
    true,
  );
}
