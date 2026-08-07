import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { postExternalBinary } from "../../../common/http/external-http-client";

export type AiVoiceTranscriptionResult = {
  readonly transcript: string;
  readonly language_hint: string;
};

const MAX_TRANSCRIPTION_RESPONSE_BYTES = 128 * 1024;

@Injectable()
export class AiVoiceTranscriptionClient {
  async transcribe(
    audioBuffer: Buffer,
    languageHint: string = "ar-EG",
  ): Promise<AiVoiceTranscriptionResult> {
    const config = externalProviderConfig();

    if (!config.aiServiceBaseUrl) {
      throw new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      );
    }

    try {
      const response = await postExternalBinary<AiVoiceTranscriptionResult>(
        `${config.aiServiceBaseUrl}/internal/v1/ai/discovery/transcribe`,
        audioBuffer,
        {
          headers: {
            "X-Voice-Internal-Token": config.voiceTranscription.internalToken,
            "X-Discovery-Language-Hint": languageHint,
          },
          timeoutMs: 30_000,
          maxBodyBytes: MAX_TRANSCRIPTION_RESPONSE_BYTES,
        },
      );

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("TOO_LARGE") || message.includes("413")) {
        throw new ProviderError(
          "DISCOVERY_TRANSCRIPTION_TOO_LARGE",
          "Audio exceeds size or duration limits.",
          false,
        );
      }
      if (message.includes("EMPTY") || message.includes("422")) {
        throw new ProviderError(
          "DISCOVERY_TRANSCRIPTION_EMPTY",
          "Audio contains no transcribable speech.",
          false,
        );
      }
      if (message.includes("INVALID_AUDIO") || message.includes("400")) {
        throw new ProviderError(
          "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO",
          "Audio format or parameters are invalid.",
          false,
        );
      }
      throw new ProviderError(
        "DISCOVERY_TRANSCRIPTION_UNAVAILABLE",
        "Voice transcription service is unavailable.",
        true,
      );
    }
  }
}
