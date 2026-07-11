import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { delay } from "../../../common/http/delay";
import { postExternalJson } from "../../../common/http/external-http-client";
import {
  EvidenceTriageDecision,
  EvidenceTriageRequest,
  EvidenceTriageResult,
} from "../intelligence/evidence-triage.types";

@Injectable()
export class AiEvidenceTriageClient {
  async triage(
    request: EvidenceTriageRequest,
    signal?: AbortSignal,
  ): Promise<EvidenceTriageResult> {
    const config = externalProviderConfig();

    if (!config.aiServiceBaseUrl) {
      throw new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI evidence triage is not configured.",
        false,
      );
    }

    let lastError: ProviderError | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await postExternalJson<unknown>(
          `${config.aiServiceBaseUrl}/internal/v1/ai/search/evidence-triage`,
          request,
          { timeoutMs: config.discoveryTriageTimeoutMs, signal },
        );

        return parseTriageResult(response);
      } catch (error) {
        signal?.throwIfAborted();
        lastError = triageProviderError(
          error,
          config.discoveryTriageTimeoutMs,
        );
        if (!lastError.retryable) {
          throw lastError;
        }
        if (attempt < 1) {
          await delay(config.aiProviderRetryDelayMs, signal);
        }
      }
    }

    throw (
      lastError ?? triageProviderError(undefined, config.discoveryTriageTimeoutMs)
    );
  }
}

function triageProviderError(error: unknown, timeoutMs: number): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ProviderError(
      "AI_TRIAGE_TIMEOUT",
      `AI evidence triage timed out after ${timeoutMs}ms.`,
      true,
    );
  }

  return new ProviderError(
    "AI_TRIAGE_PROVIDER_ERROR",
    "AI evidence triage provider failed.",
    true,
  );
}

function parseTriageResult(value: unknown): EvidenceTriageResult {
  if (!isTriageResult(value)) {
    throw new ProviderError(
      "AI_TRIAGE_INVALID_OUTPUT",
      "AI evidence triage returned invalid output.",
      true,
    );
  }

  return value;
}

function isTriageResult(value: unknown): value is EvidenceTriageResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    readonly source?: unknown;
    readonly decisions?: unknown;
  };

  return (
    candidate.source === "llm" &&
    Array.isArray(candidate.decisions) &&
    candidate.decisions.every(isTriageDecision)
  );
}

function isTriageDecision(value: unknown): value is EvidenceTriageDecision {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<EvidenceTriageDecision>;

  return (
    typeof candidate.index === "number" &&
    typeof candidate.classification === "string" &&
    typeof candidate.evidence_tier === "string" &&
    typeof candidate.confidence === "number" &&
    typeof candidate.reason === "string"
  );
}
