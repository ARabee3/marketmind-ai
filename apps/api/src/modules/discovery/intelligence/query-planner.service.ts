import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { delay } from "../../../common/http/delay";
import { AiQueryPlanningClient } from "../ai-client/ai-query-planning.client";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import { DeterministicQueryPlannerService } from "./deterministic-query-planner.service";
import { QueryPlan } from "./query-plan.types";

const AI_QUERY_PLAN_ATTEMPTS = 3;

@Injectable()
export class QueryPlannerService {
  constructor(
    private readonly aiClient: AiQueryPlanningClient,
    private readonly deterministicPlanner: DeterministicQueryPlannerService,
  ) {}

  async plan(dto: StartDiscoveryDto, signal?: AbortSignal): Promise<QueryPlan> {
    signal?.throwIfAborted();
    let lastProviderError: ProviderError | undefined;
    const retryDelayMs = externalProviderConfig().aiProviderRetryDelayMs;
    for (let attempt = 0; attempt < AI_QUERY_PLAN_ATTEMPTS; attempt += 1) {
      try {
        return await this.aiClient.plan(dto, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof ProviderError)) {
          throw error;
        }

        lastProviderError = error;
        if (!error.retryable) {
          break;
        }
        if (attempt < AI_QUERY_PLAN_ATTEMPTS - 1) {
          await delay(retryDelayMs, signal);
        }
      }
    }

    const error = lastProviderError;
    if (!error) {
      throw new ProviderError(
        "AI_QUERY_PLAN_PROVIDER_ERROR",
        "AI query planning provider failed.",
        true,
      );
    }

    const fallback = this.deterministicPlanner.plan(dto);

    return {
      ...fallback,
      warnings: [
        ...(fallback.warnings ?? []),
        `${error.code}: ${error.message}`,
      ],
    };
  }
}
