import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { delay } from "../../../common/http/delay";
import { postExternalJson } from "../../../common/http/external-http-client";
import {
  AiDiscoveryResult,
  DiscoveryCompletionContext,
  DiscoveryMessage,
  IntelligenceResult,
} from "../discovery-state";
import {
  LanguageModeDto,
  PreparedDiscoveryIntakeDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";
import { parseAiDiscoveryResult } from "./ai-discovery-response.parser";

const AI_DISCOVERY_ATTEMPTS = 5;

@Injectable()
export class AiDiscoveryClient {
  async start(
    sessionId: string,
    dto: StartDiscoveryDto,
    intelligence: IntelligenceResult,
  ): Promise<AiDiscoveryResult> {
    return this.postDiscovery("/start", {
      session_id: sessionId,
      language_mode: dto.language_mode ?? LanguageModeDto.Mixed,
      intake: dto.intake,
      intelligence,
    });
  }

  async respond(
    sessionId: string,
    languageMode: LanguageModeDto,
    intake: PreparedDiscoveryIntakeDto,
    intelligence: IntelligenceResult,
    messages: readonly DiscoveryMessage[],
    ownerMessage: DiscoveryMessage,
  ): Promise<AiDiscoveryResult> {
    return this.postDiscovery("/respond", {
      session_id: sessionId,
      language_mode: languageMode,
      intake,
      intelligence,
      messages,
      owner_message: ownerMessage,
    });
  }

  async summarize(
    sessionId: string,
    languageMode: LanguageModeDto,
    intake: PreparedDiscoveryIntakeDto,
    intelligence: IntelligenceResult,
    messages: readonly DiscoveryMessage[],
    completionContext: DiscoveryCompletionContext,
  ): Promise<AiDiscoveryResult> {
    return this.postDiscovery("/summarize", {
      session_id: sessionId,
      language_mode: languageMode,
      intake,
      intelligence,
      messages,
      completion_context: completionContext,
    });
  }

  private async postDiscovery(
    path: "/start" | "/respond" | "/summarize",
    payload: Record<string, unknown>,
  ): Promise<AiDiscoveryResult> {
    const config = externalProviderConfig();

    if (!config.aiServiceBaseUrl) {
      throw new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      );
    }

    let lastError: ProviderError | undefined;
    let lastResult: AiDiscoveryResult | undefined;

    for (let attempt = 0; attempt < AI_DISCOVERY_ATTEMPTS; attempt += 1) {
      try {
        const response = await postExternalJson<unknown>(
          `${config.aiServiceBaseUrl}/internal/v1/ai/discovery${path}`,
          payload,
          { timeoutMs: config.aiRequestTimeoutMs },
        );

        const result = parseAiDiscoveryResult(response);
        if (!result.safe_error) {
          return result;
        }

        lastResult = result;
        if (!result.safe_error.retryable) {
          return result;
        }
        if (attempt < AI_DISCOVERY_ATTEMPTS - 1) {
          await delay(config.aiProviderRetryDelayMs);
        }
      } catch (error) {
        lastError = discoveryProviderError(error);
        if (!lastError.retryable) {
          throw lastError;
        }
        if (attempt < AI_DISCOVERY_ATTEMPTS - 1) {
          await delay(config.aiProviderRetryDelayMs);
        }
      }
    }

    if (lastResult) {
      return lastResult;
    }

    throw lastError ?? discoveryProviderError(undefined);
  }
}

function discoveryProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError(
    "AI_DISCOVERY_PROVIDER_ERROR",
    "AI discovery provider failed.",
    true,
  );
}
