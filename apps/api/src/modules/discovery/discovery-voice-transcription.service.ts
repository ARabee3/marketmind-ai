import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { externalProviderConfig } from "../../common/config/external-provider.config";
import { DiscoveryRepository } from "./discovery.repository";
import { AiVoiceTranscriptionClient } from "./ai-client/ai-voice-transcription.client";
import {
  DiscoveryTranscriptionResponse,
  LanguageMode,
} from "@marketmind/contracts";
import { ProviderError } from "../../common/errors/provider-error";

const CONVERSATION_VALID_STATES = new Set([
  "partial_ready",
  "ready_for_chat",
  "research_failed",
  "in_progress",
]);

@Injectable()
export class DiscoveryVoiceTranscriptionService {
  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly aiVoiceTranscriptionClient: AiVoiceTranscriptionClient,
  ) {}

  async transcribeVoiceNote(
    ownerUserId: string,
    sessionId: string,
    audioBuffer: Buffer,
    languageHint: string = "ar-EG",
  ): Promise<DiscoveryTranscriptionResponse> {
    const config = externalProviderConfig();

    if (!config.voiceTranscription.enabled) {
      throw new ServiceUnavailableException({
        code: "DISCOVERY_TRANSCRIPTION_UNAVAILABLE",
        message: "Voice note transcription is currently disabled.",
      });
    }

    if (!config.voiceTranscription.internalToken) {
      throw new ServiceUnavailableException({
        code: "DISCOVERY_TRANSCRIPTION_UNAVAILABLE",
        message: "Voice note transcription is not configured.",
      });
    }

    const session = await this.discoveryRepository.findSessionForOwner(
      ownerUserId,
      sessionId,
    );

    if (!session) {
      throw new NotFoundException({
        code: "DISCOVERY_SESSION_NOT_FOUND",
        message: "Discovery session was not found.",
      });
    }

    if (!CONVERSATION_VALID_STATES.has(session.status)) {
      throw new ConflictException({
        code: "DISCOVERY_SESSION_STATE_CONFLICT",
        message: `Voice notes cannot be processed in session state ${session.status}.`,
      });
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new BadRequestException({
        code: "DISCOVERY_TRANSCRIPTION_EMPTY",
        message: "Audio recording is empty.",
      });
    }

    if (audioBuffer.length > config.voiceTranscription.maxBytes) {
      throw new PayloadTooLargeException({
        code: "DISCOVERY_TRANSCRIPTION_TOO_LARGE",
        message: "Audio recording exceeds maximum allowed size.",
      });
    }

    const isRiffWav =
      audioBuffer.length >= 12 &&
      audioBuffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      audioBuffer.subarray(8, 12).toString("ascii") === "WAVE";

    if (!isRiffWav) {
      throw new BadRequestException({
        code: "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO",
        message: "Audio must be a valid WAV file.",
      });
    }

    const wavInfo = readWavAudioInfo(audioBuffer);
    if (wavInfo === null) {
      throw new BadRequestException({
        code: "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO",
        message: "Audio must be a valid PCM WAV file.",
      });
    }

    if (wavInfo.dataSize === 0) {
      throw new BadRequestException({
        code: "DISCOVERY_TRANSCRIPTION_EMPTY",
        message: "Audio recording contains no samples.",
      });
    }

    if (wavInfo.durationSeconds > config.voiceTranscription.maxSeconds) {
      throw new PayloadTooLargeException({
        code: "DISCOVERY_TRANSCRIPTION_TOO_LARGE",
        message: "Audio recording exceeds the maximum duration.",
      });
    }

    let result: Awaited<ReturnType<AiVoiceTranscriptionClient["transcribe"]>>;
    try {
      result = await this.aiVoiceTranscriptionClient.transcribe(
        audioBuffer,
        toLanguageMode(languageHint),
      );
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;

      if (error.code === "DISCOVERY_TRANSCRIPTION_TOO_LARGE") {
        throw new PayloadTooLargeException({
          code: error.code,
          message: error.message,
        });
      }
      if (
        error.code === "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO" ||
        error.code === "DISCOVERY_TRANSCRIPTION_EMPTY"
      ) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }
      throw new ServiceUnavailableException({
        code: error.code,
        message: error.message,
      });
    }

    return {
      session_id: sessionId,
      transcript: result.transcript,
      language_hint: toLanguageMode(result.language_hint),
      audio_persisted: false,
    };
  }
}

function toLanguageMode(value: string | undefined): LanguageMode {
  return value === "ar-EG" || value === "en" || value === "mixed"
    ? value
    : "ar-EG";
}

function readWavAudioInfo(
  audioBuffer: Buffer,
): { durationSeconds: number; dataSize: number } | null {
  if (audioBuffer.length < 12) return null;

  let offset = 12;
  let bytesPerSecond: number | null = null;
  let dataSize: number | null = null;

  while (offset + 8 <= audioBuffer.length) {
    const chunkId = audioBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = audioBuffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > audioBuffer.length) return null;

    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = audioBuffer.readUInt16LE(chunkStart);
      const channels = audioBuffer.readUInt16LE(chunkStart + 2);
      const sampleRate = audioBuffer.readUInt32LE(chunkStart + 4);
      const byteRate = audioBuffer.readUInt32LE(chunkStart + 8);
      const bitsPerSample = audioBuffer.readUInt16LE(chunkStart + 14);

      if (
        audioFormat !== 1 ||
        channels < 1 ||
        sampleRate < 1 ||
        bitsPerSample < 1 ||
        byteRate < 1
      ) {
        return null;
      }

      bytesPerSecond = byteRate;
    }

    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (bytesPerSecond === null || dataSize === null) return null;
  return { durationSeconds: dataSize / bytesPerSecond, dataSize };
}
