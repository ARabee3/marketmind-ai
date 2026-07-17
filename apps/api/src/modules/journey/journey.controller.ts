import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import type { CurrentJourneyResponse } from "@marketmind/contracts";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { Permissions } from "../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { JourneyService } from "./journey.service";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@Controller("journey")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JourneyController {
  constructor(private readonly journeyService: JourneyService) {}

  @Get("current")
  @Permissions(PERMISSIONS.BUSINESS_READ)
  async current(
    @Req() req: RequestWithUser,
  ): Promise<CurrentJourneyResponse> {
    return this.journeyService.getCurrent(req.user.id);
  }
}
