import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { Observable } from "rxjs";
import { DiscoveryTranscriptionResponse } from "@marketmind/contracts";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { Permissions } from "../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { DiscoveryConversationService } from "./discovery-conversation.service";
import { DiscoveryRateLimitGuard } from "./discovery-rate-limit.guard";
import { DiscoveryService } from "./discovery.service";
import { DiscoveryStreamService } from "./discovery-stream.service";
import { DiscoveryVoiceTranscriptionService } from "./discovery-voice-transcription.service";
import {
  ConfirmProfileDto,
  DiscoveryRespondDto,
  DiscoverySummarizeDto,
} from "./dto/discovery-conversation.dto";
import { StartDiscoveryDto } from "./dto/start-discovery.dto";
import {
  ConfirmProfileResponse,
  DiscoveryRespondResponse,
  DiscoveryStatusResponse,
  DiscoverySummarizeResponse,
  StartDiscoveryResponse,
} from "./discovery-state";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

const ALLOWED_VOICE_MIME_TYPES = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
]);

@Controller("discovery")
@UseGuards(JwtAuthGuard, PermissionsGuard, DiscoveryRateLimitGuard)
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly conversationService: DiscoveryConversationService,
    private readonly voiceTranscriptionService: DiscoveryVoiceTranscriptionService,
    private readonly streamService: DiscoveryStreamService,
  ) {}

  @Post("start")
  @Permissions(PERMISSIONS.DISCOVERY_START)
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @Req() req: RequestWithUser,
    @Body() dto: StartDiscoveryDto,
  ): Promise<StartDiscoveryResponse> {
    return this.discoveryService.startPreparedDiscovery(req.user.id, dto);
  }

  @Get(":sessionId/status")
  async status(
    @Req() req: RequestWithUser,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
  ): Promise<DiscoveryStatusResponse> {
    return this.discoveryService.getStatus(req.user.id, sessionId);
  }

  @Sse(":sessionId/stream")
  @Permissions(PERMISSIONS.DISCOVERY_CONTINUE)
  stream(
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
  ): Observable<MessageEvent> {
    return this.streamService.getStream(sessionId);
  }

  @Post(":sessionId/respond")
  @Permissions(PERMISSIONS.DISCOVERY_CONTINUE)
  async respond(
    @Req() req: RequestWithUser,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Body() dto: DiscoveryRespondDto,
  ): Promise<DiscoveryRespondResponse> {
    return this.conversationService.respondToDiscovery(
      req.user.id,
      sessionId,
      dto,
    );
  }

  @Post(":sessionId/transcribe")
  @Permissions(PERMISSIONS.DISCOVERY_CONTINUE)
  @UseInterceptors(
    FileInterceptor("audio", { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async transcribe(
    @Req() req: RequestWithUser,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @UploadedFile() file?: { buffer: Buffer; mimetype?: string },
    @Body("language_hint") languageHint?: string,
  ): Promise<DiscoveryTranscriptionResponse> {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: "DISCOVERY_TRANSCRIPTION_EMPTY",
        message: "No audio file uploaded.",
      });
    }

    if (!file.mimetype || !ALLOWED_VOICE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: "DISCOVERY_TRANSCRIPTION_INVALID_AUDIO",
        message: "Audio must be uploaded as a WAV file.",
      });
    }

    return this.voiceTranscriptionService.transcribeVoiceNote(
      req.user.id,
      sessionId,
      file.buffer,
      languageHint,
    );
  }

  @Post(":sessionId/summarize")
  @Permissions(PERMISSIONS.DISCOVERY_CONTINUE)
  async summarize(
    @Req() req: RequestWithUser,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Body() dto: DiscoverySummarizeDto,
  ): Promise<DiscoverySummarizeResponse> {
    return this.conversationService.summarizeDiscovery(
      req.user.id,
      sessionId,
      dto,
    );
  }

  @Post(":sessionId/confirm-profile")
  @Permissions(PERMISSIONS.DISCOVERY_CONFIRM_PROFILE)
  async confirmProfile(
    @Req() req: RequestWithUser,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Body() dto: ConfirmProfileDto,
  ): Promise<ConfirmProfileResponse> {
    return this.conversationService.confirmProfile(req.user.id, sessionId, dto);
  }
}
