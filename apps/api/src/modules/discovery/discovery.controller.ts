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
import { DiscoveryService } from "./discovery.service";
import { StartDiscoveryDto } from "./dto/start-discovery.dto";
import { DiscoveryStatusResponse, StartDiscoveryResponse } from "./discovery-state";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@Controller("discovery")
@UseGuards(JwtAuthGuard)
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

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
}
