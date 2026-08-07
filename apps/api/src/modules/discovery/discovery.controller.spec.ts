import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { DiscoveryConversationService } from "./discovery-conversation.service";
import { DiscoveryVoiceTranscriptionService } from "./discovery-voice-transcription.service";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";
import { PERMISSIONS_KEY } from "../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { RbacService } from "../rbac/rbac.service";
import { emptyDiscoveryProfileState } from "./market-profile";
import { DiscoveryRateLimitGuard } from "./discovery-rate-limit.guard";
import { DiscoveryRedisLimiterService } from "./discovery-redis-limiter.service";
import { RedisService } from "../redis/redis.service";

describe("DiscoveryController", () => {
  const service = {
    startPreparedDiscovery: jest.fn(),
    getStatus: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryService>;
  const conversationService = {
    respondToDiscovery: jest.fn(),
    summarizeDiscovery: jest.fn(),
    confirmProfile: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryConversationService>;
  const voiceTranscriptionService = {
    transcribeVoiceNote: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryVoiceTranscriptionService>;

  let controller: DiscoveryController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscoveryController],
      providers: [
        { provide: DiscoveryService, useValue: service },
        {
          provide: DiscoveryConversationService,
          useValue: conversationService,
        },
        {
          provide: DiscoveryVoiceTranscriptionService,
          useValue: voiceTranscriptionService,
        },
        RbacService,
        DiscoveryRateLimitGuard,
        DiscoveryRedisLimiterService,
        {
          provide: RedisService,
          useValue: { ping: jest.fn(), getClient: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<DiscoveryController>(DiscoveryController);
  });

  it("starts discovery for the authenticated owner", async () => {
    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
      },
    };
    service.startPreparedDiscovery.mockResolvedValue({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
      progress_ws_url: "/ws/v1/discovery",
      status_url:
        "/api/v1/discovery/11111111-1111-4111-8111-111111111111/status",
      accepted_at: "2026-06-29T10:00:00.000Z",
    });

    const result = await controller.start(
      {
        user: { id: "owner-id", email: "owner@example.com", roles: [] },
      } as never,
      dto,
    );

    expect(result.status).toBe("researching");
    expect(service.startPreparedDiscovery).toHaveBeenCalledWith(
      "owner-id",
      dto,
    );
  });

  it("reads status for the authenticated owner", async () => {
    service.getStatus.mockResolvedValue({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
      language_mode: LanguageModeDto.Mixed,
      intake_summary: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
      },
      intelligence: {
        status: "running",
        search_mode: "metadata_only",
        source_refs: [],
        research_observations: [],
        conversation_hooks: [],
        knowledge_gaps: [],
      },
      messages: [],
      profile_state: emptyDiscoveryProfileState(),
      progress_events: [],
      strategy_locked: true,
    });

    const result = await controller.status(
      {
        user: { id: "owner-id", email: "owner@example.com", roles: [] },
      } as never,
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.session_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(service.getStatus).toHaveBeenCalledWith(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("forwards an owner WAV upload without creating a discovery turn", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const response = {
      session_id: sessionId,
      transcript: "أنا عندي كافيه صغير",
      language_hint: "ar-EG" as const,
      audio_persisted: false as const,
    };
    voiceTranscriptionService.transcribeVoiceNote.mockResolvedValue(response);

    const result = await controller.transcribe(
      {
        user: { id: "owner-id", email: "owner@example.com", roles: [] },
      } as never,
      sessionId,
      { buffer: Buffer.from("RIFF....WAVE"), mimetype: "audio/wav" },
      "ar-EG",
    );

    expect(result).toEqual(response);
    expect(voiceTranscriptionService.transcribeVoiceNote).toHaveBeenCalledWith(
      "owner-id",
      sessionId,
      expect.any(Buffer),
      "ar-EG",
    );
  });

  it("rejects non-WAV uploads before calling the transcription service", async () => {
    await expect(
      controller.transcribe(
        {
          user: { id: "owner-id", email: "owner@example.com", roles: [] },
        } as never,
        "11111111-1111-4111-8111-111111111111",
        { buffer: Buffer.from("RIFF....WAVE"), mimetype: "audio/webm" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      voiceTranscriptionService.transcribeVoiceNote,
    ).not.toHaveBeenCalled();
  });

  it("declares RBAC permissions for protected discovery actions", () => {
    expect(getPermissions("start")).toEqual([PERMISSIONS.DISCOVERY_START]);
    expect(getPermissions("respond")).toEqual([PERMISSIONS.DISCOVERY_CONTINUE]);
    expect(getPermissions("transcribe")).toEqual([
      PERMISSIONS.DISCOVERY_CONTINUE,
    ]);
    expect(getPermissions("summarize")).toEqual([
      PERMISSIONS.DISCOVERY_CONTINUE,
    ]);
    expect(getPermissions("confirmProfile")).toEqual([
      PERMISSIONS.DISCOVERY_CONFIRM_PROFILE,
    ]);
    expect(getPermissions("status")).toBeUndefined();
  });

  it("runs the permissions guard on discovery routes", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DiscoveryController);

    expect(guards).toContain(PermissionsGuard);
  });
});

type DiscoveryRoute =
  | "start"
  | "status"
  | "respond"
  | "transcribe"
  | "summarize"
  | "confirmProfile";

function getPermissions(route: DiscoveryRoute): unknown {
  return Reflect.getMetadata(
    PERMISSIONS_KEY,
    DiscoveryController.prototype[route],
  );
}
