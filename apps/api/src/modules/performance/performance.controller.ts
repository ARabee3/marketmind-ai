import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { Permissions } from "../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { PerformanceService } from "./performance.service";

type RequestWithUser = Request & { user: AuthenticatedUser };

/** Owner-scoped Facebook performance reads and asynchronous refresh requests. */
@Controller("performance/facebook")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.BUSINESS_READ)
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get("overview")
  overview(@Req() req: RequestWithUser) {
    return this.performance.getOverview(req.user.id);
  }

  @Get("posts")
  posts(
    @Req() req: RequestWithUser,
    @Query("cursor") cursor?: string,
    @Query("format") format?: string,
  ) {
    return this.performance.listPosts(req.user.id, { cursor, format });
  }

  @Get("posts/:publishingResultId/snapshots")
  snapshots(
    @Req() req: RequestWithUser,
    @Param("publishingResultId", ParseUUIDPipe) publishingResultId: string,
  ) {
    return this.performance.listSnapshots(req.user.id, publishingResultId);
  }

  @Post("posts/:publishingResultId/refresh")
  refresh(
    @Req() req: RequestWithUser,
    @Param("publishingResultId", ParseUUIDPipe) publishingResultId: string,
  ) {
    return this.performance.refresh(req.user.id, publishingResultId);
  }
}
