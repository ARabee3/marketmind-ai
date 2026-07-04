import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { AiQueryPlanningClient } from "../ai-client/ai-query-planning.client";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import { DeterministicQueryPlannerService } from "./deterministic-query-planner.service";
import { QueryPlan } from "./query-plan.types";

@Injectable()
export class QueryPlannerService {
  constructor(
    private readonly aiClient: AiQueryPlanningClient,
    private readonly deterministicPlanner: DeterministicQueryPlannerService,
  ) {}

  async plan(dto: StartDiscoveryDto, signal?: AbortSignal): Promise<QueryPlan> {
    signal?.throwIfAborted();
    try {
      return await this.aiClient.plan(dto, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof ProviderError)) {
        throw error;
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
}
