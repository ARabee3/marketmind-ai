import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { postExternalJson } from "../../../common/http/external-http-client";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import {
  PlannedSearchQuery,
  QueryPlan,
} from "../intelligence/query-plan.types";

@Injectable()
export class AiQueryPlanningClient {
  async plan(dto: StartDiscoveryDto): Promise<QueryPlan> {
    const config = externalProviderConfig();

    if (!config.aiServiceBaseUrl) {
      throw new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI query planning is not configured.",
        false,
      );
    }

    try {
      const response = await postExternalJson<unknown>(
        `${config.aiServiceBaseUrl}/internal/v1/ai/search/query-plan`,
        dto,
        { timeoutMs: config.discoverySearchTimeoutMs },
      );

      return parseQueryPlan(response);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      throw new ProviderError(
        "AI_QUERY_PLAN_PROVIDER_ERROR",
        error instanceof Error
          ? error.message
          : "AI query planning provider failed.",
        true,
      );
    }
  }
}

function parseQueryPlan(value: unknown): QueryPlan {
  if (!isQueryPlan(value)) {
    throw new ProviderError(
      "AI_QUERY_PLAN_INVALID_OUTPUT",
      "AI query planning returned invalid output.",
      true,
    );
  }

  return {
    source: value.source,
    queries: value.queries,
    warnings: value.warnings,
  };
}

function isQueryPlan(value: unknown): value is QueryPlan {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    readonly queries?: unknown;
    readonly source?: unknown;
  };

  return (
    (candidate.source === "llm" || candidate.source === "deterministic") &&
    Array.isArray(candidate.queries) &&
    candidate.queries.length > 0 &&
    candidate.queries.every(isPlannedSearchQuery)
  );
}

function isPlannedSearchQuery(value: unknown): value is PlannedSearchQuery {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<PlannedSearchQuery>;

  return (
    typeof candidate.intent === "string" &&
    typeof candidate.query === "string" &&
    typeof candidate.language === "string" &&
    typeof candidate.priority === "number" &&
    Array.isArray(candidate.provider_hints)
  );
}
