import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { postExternalJson } from "../../../common/http/external-http-client";
import { IntelligenceResult } from "../discovery-state";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";

export type AiDiscoveryStartResult = {
  readonly action:
    | "ask_next_question"
    | "ask_clarification"
    | "produce_profile_draft"
    | "safe_failure";
  readonly next_question?: string;
};

@Injectable()
export class AiDiscoveryClient {
  async start(
    sessionId: string,
    dto: StartDiscoveryDto,
    intelligence: IntelligenceResult,
  ): Promise<AiDiscoveryStartResult> {
    const config = externalProviderConfig();

    if (!config.aiServiceBaseUrl) {
      throw new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      );
    }

    try {
      const response = await postExternalJson<unknown>(
        `${config.aiServiceBaseUrl}/internal/v1/ai/discovery/start`,
        {
          session_id: sessionId,
          language_mode: dto.language_mode ?? LanguageModeDto.Mixed,
          intake: dto.intake,
          intelligence,
        },
        { timeoutMs: config.discoverySearchTimeoutMs },
      );

      return parseAiDiscoveryStartResult(response);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      throw new ProviderError(
        "AI_DISCOVERY_PROVIDER_ERROR",
        error instanceof Error
          ? error.message
          : "AI discovery provider failed.",
        true,
      );
    }
  }
}

function parseAiDiscoveryStartResult(value: unknown): AiDiscoveryStartResult {
  if (typeof value !== "object" || value === null) {
    throw invalidOutput();
  }

  const candidate = value as {
    readonly action?: unknown;
    readonly next_question?: unknown;
  };

  if (!isAction(candidate.action)) {
    throw invalidOutput();
  }

  return {
    action: candidate.action,
    next_question:
      typeof candidate.next_question === "string"
        ? candidate.next_question
        : undefined,
  };
}

function isAction(value: unknown): value is AiDiscoveryStartResult["action"] {
  return (
    value === "ask_next_question" ||
    value === "ask_clarification" ||
    value === "produce_profile_draft" ||
    value === "safe_failure"
  );
}

function invalidOutput(): ProviderError {
  return new ProviderError(
    "AI_DISCOVERY_INVALID_OUTPUT",
    "AI discovery returned invalid output.",
    true,
  );
}
