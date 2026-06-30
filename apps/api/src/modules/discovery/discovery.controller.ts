import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { DiscoveryConversationService } from "./discovery-conversation.service";
import { DiscoveryRateLimitGuard } from "./discovery-rate-limit.guard";
import { DiscoveryService } from "./discovery.service";
import {
  ConfirmProfileDto,
  DiscoveryRespondDto,
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

@Controller("discovery")
@UseGuards(JwtAuthGuard, DiscoveryRateLimitGuard)
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly conversationService: DiscoveryConversationService,
  ) {}

  @Post("start")
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

  @Post(":sessionId/respond")
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

  @Post(":sessionId/summarize")
  async summarize(
    @Req() req: RequestWithUser,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
  ): Promise<DiscoverySummarizeResponse> {
    return this.conversationService.summarizeDiscovery(req.user.id, sessionId);
  }

  @Post(":sessionId/confirm-profile")
  async confirmProfile(
    @Req() req: RequestWithUser,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Body() dto: ConfirmProfileDto,
  ): Promise<ConfirmProfileResponse> {
    return this.conversationService.confirmProfile(req.user.id, sessionId, dto);
  }
}
