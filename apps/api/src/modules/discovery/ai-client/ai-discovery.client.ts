import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { postExternalJson } from "../../../common/http/external-http-client";
import {
  AiDiscoveryResult,
  DiscoveryMessage,
  IntelligenceResult,
} from "../discovery-state";
import {
  LanguageModeDto,
  PreparedDiscoveryIntakeDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";
import { parseAiDiscoveryResult } from "./ai-discovery-response.parser";

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
  ): Promise<AiDiscoveryResult> {
    return this.postDiscovery("/summarize", {
      session_id: sessionId,
      language_mode: languageMode,
      intake,
      intelligence,
      messages,
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

    try {
      const response = await postExternalJson<unknown>(
        `${config.aiServiceBaseUrl}/internal/v1/ai/discovery${path}`,
        payload,
        { timeoutMs: config.discoverySearchTimeoutMs },
      );

      return parseAiDiscoveryResult(response);
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
