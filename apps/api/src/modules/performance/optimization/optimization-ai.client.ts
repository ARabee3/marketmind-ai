import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import {
  assertValidOptimizationAgentResultV1,
  validateOptimizationGenerationRequestV1,
  type OptimizationAgentResultV1,
  type OptimizationGenerationRequestV1,
} from "@marketmind/contracts";
import { ProviderError } from "../../../common/errors/provider-error";

const OPTIMIZATION_AI_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Narrow NestJS/FastAPI boundary for Optimization 1. The request is already
 * deterministic and provider-free; this client never sends credentials or
 * arbitrary database identifiers to FastAPI.
 */
@Injectable()
export class OptimizationAiClient {
  private readonly aiUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiUrl =
      this.config.get<string>("aiService.url") ?? "http://localhost:8000";
  }

  async generate(
    request: OptimizationGenerationRequestV1,
  ): Promise<OptimizationAgentResultV1> {
    const validation = validateOptimizationGenerationRequestV1(request);
    if (!validation.valid) {
      throw new ProviderError(
        "OPTIMIZATION_SCHEMA_FAILURE",
        "Optimization generation request failed deterministic validation.",
        false,
      );
    }
    let response: unknown;
    try {
      const result = await firstValueFrom(
        this.http.post(
          `${this.aiUrl}/internal/v1/ai/optimization/propose`,
          request,
          { timeout: OPTIMIZATION_AI_REQUEST_TIMEOUT_MS },
        ),
      );
      response = result.data;
    } catch (error) {
      throw toOptimizationProviderError(error);
    }
    try {
      assertValidOptimizationAgentResultV1(response);
    } catch {
      throw new ProviderError(
        "OPTIMIZATION_SCHEMA_FAILURE",
        "AI optimization service returned an invalid response.",
        false,
      );
    }
    if (response.generation_fingerprint !== request.generation_fingerprint) {
      throw new ProviderError(
        "OPTIMIZATION_IDENTITY_CONFLICT",
        "AI optimization response identity does not match the request.",
        false,
      );
    }
    return response;
  }
}

function toOptimizationProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const candidate = error as {
    response?: {
      status?: number;
      data?: {
        detail?: {
          error_type?: unknown;
          message?: unknown;
          retryable?: unknown;
        };
      };
    };
    code?: string;
  };
  const status = candidate.response?.status;
  if (typeof status === "number") {
    const detail = candidate.response?.data?.detail;
    const retryable =
      typeof detail?.retryable === "boolean"
        ? detail.retryable
        : status >= 500 || status === 429;
    return new ProviderError(
      typeof detail?.error_type === "string" &&
        detail.error_type.startsWith("OPTIMIZATION_")
        ? detail.error_type
        : "OPTIMIZATION_PROVIDER_FAILURE",
      typeof detail?.message === "string"
        ? detail.message
        : `AI optimization service returned HTTP ${status}.`,
      retryable,
    );
  }
  return new ProviderError(
    "OPTIMIZATION_PROVIDER_FAILURE",
    "AI optimization service request failed.",
    true,
  );
}
