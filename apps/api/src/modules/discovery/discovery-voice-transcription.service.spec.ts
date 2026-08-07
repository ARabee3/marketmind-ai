import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DiscoveryVoiceTranscriptionService } from "./discovery-voice-transcription.service";
import { DiscoveryRepository } from "./discovery.repository";
import { AiVoiceTranscriptionClient } from "./ai-client/ai-voice-transcription.client";
import { ProviderError } from "../../common/errors/provider-error";

describe("DiscoveryVoiceTranscriptionService", () => {
  let service: DiscoveryVoiceTranscriptionService;
  let discoveryRepository: jest.Mocked<DiscoveryRepository>;
  let aiVoiceTranscriptionClient: jest.Mocked<AiVoiceTranscriptionClient>;

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DISCOVERY_VOICE_NOTES_ENABLED = "true";
    process.env.VOICE_TRANSCRIPTION_INTERNAL_TOKEN = "test-token";

    discoveryRepository = {
      findSessionForOwner: jest.fn(),
    } as unknown as jest.Mocked<DiscoveryRepository>;

    aiVoiceTranscriptionClient = {
      transcribe: jest.fn(),
    } as unknown as jest.Mocked<AiVoiceTranscriptionClient>;

    service = new DiscoveryVoiceTranscriptionService(
      discoveryRepository,
      aiVoiceTranscriptionClient,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makeValidWavBuffer(durationSeconds = 0): Buffer {
    const sampleRate = 8000;
    const bytesPerSample = 2;
    const dataSize = Math.floor(durationSeconds * sampleRate * bytesPerSample);
    const header = Buffer.alloc(44 + dataSize);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24); // sample rate
    header.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return header;
  }

  it("should throw ServiceUnavailableException if feature flag is disabled", async () => {
    process.env.DISCOVERY_VOICE_NOTES_ENABLED = "false";
    const wav = makeValidWavBuffer(1);

    await expect(
      service.transcribeVoiceNote("user-1", "session-1", wav),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("should throw NotFoundException if session does not exist or user does not match", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue(null);
    const wav = makeValidWavBuffer(1);

    await expect(
      service.transcribeVoiceNote("user-1", "session-1", wav),
    ).rejects.toThrow(NotFoundException);
  });

  it("should fail closed when the internal token is missing", async () => {
    delete process.env.VOICE_TRANSCRIPTION_INTERNAL_TOKEN;

    await expect(
      service.transcribeVoiceNote("user-1", "session-1", makeValidWavBuffer(1)),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("should throw ConflictException if session status is not conversation-valid", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "confirmed",
    } as any);
    const wav = makeValidWavBuffer();

    await expect(
      service.transcribeVoiceNote("user-1", "session-1", wav),
    ).rejects.toThrow(ConflictException);
  });

  it("should throw BadRequestException if buffer is empty", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "ready_for_chat",
    } as any);

    await expect(
      service.transcribeVoiceNote("user-1", "session-1", Buffer.alloc(0)),
    ).rejects.toThrow(BadRequestException);
  });

  it("should reject a WAV container with no audio samples", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "ready_for_chat",
    } as any);

    await expect(
      service.transcribeVoiceNote("user-1", "session-1", makeValidWavBuffer()),
    ).rejects.toThrow(BadRequestException);
    expect(aiVoiceTranscriptionClient.transcribe).not.toHaveBeenCalled();
  });

  it("should throw PayloadTooLargeException if buffer exceeds maxBytes", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "ready_for_chat",
    } as any);

    const hugeBuffer = Buffer.alloc(6 * 1024 * 1024);
    await expect(
      service.transcribeVoiceNote("user-1", "session-1", hugeBuffer),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it("should throw BadRequestException if buffer is not RIFF WAVE", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "ready_for_chat",
    } as any);

    const invalidWav = Buffer.from(
      "NOT_A_WAV_FILE_CONTENT_HERE_EXTENDED_BUFFER",
    );
    await expect(
      service.transcribeVoiceNote("user-1", "session-1", invalidWav),
    ).rejects.toThrow(BadRequestException);
  });

  it("should reject a valid WAV that exceeds the configured duration", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "ready_for_chat",
    } as any);

    await expect(
      service.transcribeVoiceNote(
        "user-1",
        "session-1",
        makeValidWavBuffer(46),
      ),
    ).rejects.toThrow(PayloadTooLargeException);
    expect(aiVoiceTranscriptionClient.transcribe).not.toHaveBeenCalled();
  });

  it("should successfully call aiVoiceTranscriptionClient and return response", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "ready_for_chat",
    } as any);

    aiVoiceTranscriptionClient.transcribe.mockResolvedValue({
      transcript: "أنا عندي كافيه صغير",
      language_hint: "ar-EG",
    });

    const wav = makeValidWavBuffer(1);
    const result = await service.transcribeVoiceNote(
      "user-1",
      "session-1",
      wav,
      "ar-EG",
    );

    expect(result).toEqual({
      session_id: "session-1",
      transcript: "أنا عندي كافيه صغير",
      language_hint: "ar-EG",
      audio_persisted: false,
    });
    expect(aiVoiceTranscriptionClient.transcribe).toHaveBeenCalledWith(
      wav,
      "ar-EG",
    );
  });

  it("maps bounded provider failures to stable HTTP errors", async () => {
    discoveryRepository.findSessionForOwner.mockResolvedValue({
      id: "session-1",
      owner_id: "user-1",
      status: "ready_for_chat",
    } as any);
    aiVoiceTranscriptionClient.transcribe.mockRejectedValue(
      new ProviderError(
        "DISCOVERY_TRANSCRIPTION_TOO_LARGE",
        "Audio exceeds size or duration limits.",
        false,
      ),
    );

    await expect(
      service.transcribeVoiceNote("user-1", "session-1", makeValidWavBuffer(1)),
    ).rejects.toThrow(PayloadTooLargeException);
  });
});
