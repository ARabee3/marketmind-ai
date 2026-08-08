import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { ProviderError } from "../../common/errors/provider-error";
import {
  AiContentGenerateRequest,
  AiContentGenerateResponse,
  AiContentReviseRequest,
  AiContentReviseResponse,
  AiContentV2PlanRequest,
  AiContentV2PlanResponse,
  AiStaticAssetGenerateRequest,
  AiStaticAssetGenerateResponse,
  ContentItemVersion,
  validateInternalContentGenerateRequest,
  validateInternalContentV2PlanRequest,
} from "@marketmind/contracts";

const CONTENT_AI_REQUEST_TIMEOUT_MS = 60_000;

type ContentReviseEnvelope = {
  readonly request: AiContentReviseRequest;
  readonly previous_item_version: ContentItemVersion;
  readonly generation_request: AiContentGenerateRequest;
};

/**
 * HTTP client for the FastAPI content-generation service.
 *
 * The provider side (prompts/models) is owned by issue #108; this client only
 * defines the internal contract boundary the API relies on. It validates the
 * outgoing generate request, maps transport failures (non-2xx, timeout,
 * ECONNABORTED) to a retryable CONTENT_PROVIDER_FAILURE ProviderError, and
 * gates the provider response: a wrong contract version, missing payload, or a
 * failed provider-side validation becomes a non-retryable
 * CONTENT_SCHEMA_FAILURE so the processor never persists garbage.
 */
@Injectable()
export class ContentAiClient {
  private readonly logger = new Logger(ContentAiClient.name);
  private readonly aiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiUrl =
      this.config.get<string>("aiService.url") ?? "http://localhost:8000";
  }

  async generate(
    request: AiContentGenerateRequest,
  ): Promise<AiContentGenerateResponse> {
    const validation = validateInternalContentGenerateRequest(request);
    if (!validation.valid) {
      throw new ProviderError(
        "CONTENT_SCHEMA_FAILURE",
        "Content generate request failed deterministic validation.",
        false,
      );
    }

    const response = await this.post<AiContentGenerateResponse>(
      "/internal/v1/ai/content/generate",
      request,
    );

    if (!isGenerateResponse(response)) {
      throw new ProviderError(
        "CONTENT_SCHEMA_FAILURE",
        "AI content service returned an invalid generate response.",
        false,
      );
    }

    return response;
  }

  /**
   * Planner stage (content-v2, issue #187): returns 3–5 high-level post
   * cards for the requested week. Never returns publishable copy.
   */
  async plan(
    request: AiContentV2PlanRequest,
  ): Promise<AiContentV2PlanResponse> {
    const validation = validateInternalContentV2PlanRequest(request);
    if (!validation.valid) {
      throw new ProviderError(
        "CONTENT_SCHEMA_FAILURE",
        "Content plan request failed deterministic validation.",
        false,
      );
    }

    const response = await this.post<AiContentV2PlanResponse>(
      "/internal/v1/ai/content/v2/plan",
      request,
    );

    if (!isPlanResponse(response)) {
      throw new ProviderError(
        "CONTENT_SCHEMA_FAILURE",
        "AI content service returned an invalid plan response.",
        false,
      );
    }

    return response;
  }

  async revise(
    envelope: ContentReviseEnvelope,
  ): Promise<AiContentReviseResponse> {
    const response = await this.post<AiContentReviseResponse>(
      "/internal/v1/ai/content/revise",
      envelope,
    );

    if (!isReviseResponse(response)) {
      throw new ProviderError(
        "CONTENT_SCHEMA_FAILURE",
        "AI content service returned an invalid revise response.",
        false,
      );
    }

    return response;
  }

  async generateStaticAsset(
    request: AiStaticAssetGenerateRequest,
  ): Promise<AiStaticAssetGenerateResponse> {
    const response = await this.post<AiStaticAssetGenerateResponse>(
      "/internal/v1/ai/content/assets/generate-static",
      request,
    );

    if (!isStaticAssetResponse(response)) {
      throw new ProviderError(
        "CONTENT_SCHEMA_FAILURE",
        "AI content service returned an invalid static-asset response.",
        false,
      );
    }

    return response;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiUrl}${path}`, payload, {
          timeout: CONTENT_AI_REQUEST_TIMEOUT_MS,
        }),
      );
      return response.data as T;
    } catch (error) {
      throw toContentProviderError(error);
    }
  }
}

function toContentProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const candidate = error as { response?: { status?: number }; code?: string };
  const status = candidate.response?.status;

  if (typeof status === "number") {
    const retryable = status >= 500 || status === 429;
    return new ProviderError(
      "CONTENT_PROVIDER_FAILURE",
      `AI content service returned HTTP ${status}.`,
      retryable,
    );
  }

  return new ProviderError(
    "CONTENT_PROVIDER_FAILURE",
    "AI content service request failed.",
    true,
  );
}

function isContentValidationPassed(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as { valid?: unknown }).valid === true;
}

function isGenerateResponse(
  value: unknown,
): value is AiContentGenerateResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contract_version === "content-v1" &&
    typeof candidate.content_pack === "object" &&
    candidate.content_pack !== null &&
    Array.isArray(candidate.item_versions) &&
    isContentValidationPassed(candidate.validation)
  );
}

function isReviseResponse(value: unknown): value is AiContentReviseResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contract_version === "content-v1" &&
    typeof candidate.item_version === "object" &&
    candidate.item_version !== null &&
    isContentValidationPassed(candidate.validation)
  );
}

function isStaticAssetResponse(
  value: unknown,
): value is AiStaticAssetGenerateResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contract_version === "content-v1" &&
    typeof candidate.asset === "object" &&
    candidate.asset !== null &&
    isContentValidationPassed(candidate.validation)
  );
}

function isPlanResponse(value: unknown): value is AiContentV2PlanResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.contract_version === "content-v2" &&
    Array.isArray(candidate.post_plans) &&
    candidate.post_plans.length >= 3 &&
    candidate.post_plans.length <= 5 &&
    isContentValidationPassed(candidate.validation)
  );
}
