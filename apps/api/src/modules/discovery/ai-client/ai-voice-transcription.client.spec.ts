import { AiVoiceTranscriptionClient } from "./ai-voice-transcription.client";
import * as externalHttpClient from "../../../common/http/external-http-client";
import { ProviderError } from "../../../common/errors/provider-error";

jest.mock("../../../common/http/external-http-client");

describe("AiVoiceTranscriptionClient", () => {
  let client: AiVoiceTranscriptionClient;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AI_SERVICE_BASE_URL = "http://localhost:8000";
    process.env.VOICE_TRANSCRIPTION_INTERNAL_TOKEN = "test-token";
    client = new AiVoiceTranscriptionClient();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw ProviderError if AI_SERVICE_BASE_URL is not set", async () => {
    delete process.env.AI_SERVICE_BASE_URL;
    const wav = Buffer.from("RIFF....WAVE");

    await expect(client.transcribe(wav, "ar-EG")).rejects.toThrow(
      ProviderError,
    );
  });

  it("should call postExternalBinary with correct url, token and return result", async () => {
    const postExternalBinaryMock =
      externalHttpClient.postExternalBinary as jest.Mock;
    postExternalBinaryMock.mockResolvedValue({
      transcript: "أنا عندي كافيه صغير",
      language_hint: "ar-EG",
    });

    const wav = Buffer.from("RIFF....WAVE");
    const result = await client.transcribe(wav, "ar-EG");

    expect(result).toEqual({
      transcript: "أنا عندي كافيه صغير",
      language_hint: "ar-EG",
    });
    expect(postExternalBinaryMock).toHaveBeenCalledWith(
      "http://localhost:8000/internal/v1/ai/discovery/transcribe",
      wav,
      {
        headers: {
          "X-Voice-Internal-Token": "test-token",
          "X-Discovery-Language-Hint": "ar-EG",
        },
        timeoutMs: 30000,
        maxBodyBytes: 128 * 1024,
      },
    );
  });

  it("should map 400 error to DISCOVERY_TRANSCRIPTION_INVALID_AUDIO", async () => {
    const postExternalBinaryMock =
      externalHttpClient.postExternalBinary as jest.Mock;
    postExternalBinaryMock.mockRejectedValue(
      new Error("External binary request failed with 400: INVALID_AUDIO"),
    );

    const wav = Buffer.from("RIFF....WAVE");
    await expect(client.transcribe(wav, "ar-EG")).rejects.toThrow(
      new ProviderError(
        "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO",
        "Audio format or parameters are invalid.",
        false,
      ),
    );
  });

  it("checks bounded error markers before the HTTP status", async () => {
    const postExternalBinaryMock =
      externalHttpClient.postExternalBinary as jest.Mock;
    postExternalBinaryMock.mockRejectedValue(
      new Error("External binary request failed with 400: TOO_LARGE"),
    );

    await expect(
      client.transcribe(Buffer.from("RIFF....WAVE"), "ar-EG"),
    ).rejects.toThrow(
      new ProviderError(
        "DISCOVERY_TRANSCRIPTION_TOO_LARGE",
        "Audio exceeds size or duration limits.",
        false,
      ),
    );
  });

  it("does not expose upstream error details for unavailable providers", async () => {
    const postExternalBinaryMock =
      externalHttpClient.postExternalBinary as jest.Mock;
    postExternalBinaryMock.mockRejectedValue(
      new Error("External binary request failed with 502: provider-secret"),
    );

    await expect(
      client.transcribe(Buffer.from("RIFF....WAVE"), "ar-EG"),
    ).rejects.toThrow("Voice transcription service is unavailable.");
  });
});
