import {
  Controller,
  Post,
  Put,
  Get,
  Param,
  Body,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
  ParseIntPipe,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { Permissions } from "../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { ContentRateLimitGuard } from "./content-rate-limit.guard";
import { ContentService } from "./content.service";
import { CreateContentCycleDto } from "./dto/create-content-cycle.dto";
import { UpsertWeekContextDto } from "./dto/upsert-week-context.dto";
import { GenerateContentWeekDto } from "./dto/generate-content-week.dto";
import { ContentDecisionDto } from "./dto/content-decision.dto";
import { BulkContentDecisionDto } from "./dto/bulk-content-decision.dto";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

/**
 * Content lifecycle endpoints for content cycles.
 *
 * Every route requires authentication (JwtAuthGuard) and the
 * `content:start` permission (PermissionsGuard), plus the per-owner content
 * rate limit. Ownership is re-verified server-side in the service via
 * getCycleByIdAndOwner, so a user can only operate on cycles belonging to
 * businesses they own — cross-business access returns 404 rather than 403 to
 * avoid leaking the existence of other owners' cycles.
 */
@Controller("content-cycles")
@UseGuards(JwtAuthGuard, PermissionsGuard, ContentRateLimitGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class ContentCycleController {
  constructor(private readonly contentService: ContentService) {}

  @Post()
  @Permissions(PERMISSIONS.CONTENT_START)
  createCycle(@Req() req: RequestWithUser, @Body() dto: CreateContentCycleDto) {
    return this.contentService.createCycle(dto, req.user.id);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.CONTENT_START)
  getCycle(@Param("id", ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    return this.contentService.getCycle(id, req.user.id);
  }

  @Post(":id/pause")
  @Permissions(PERMISSIONS.CONTENT_START)
  pauseCycle(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: { reason?: string },
  ) {
    return this.contentService.pauseCycle(id, req.user.id, dto.reason ?? null);
  }

  @Post(":id/resume")
  @Permissions(PERMISSIONS.CONTENT_START)
  resumeCycle(@Param("id", ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    return this.contentService.resumeCycle(id, req.user.id);
  }

  @Get(":id/weeks")
  @Permissions(PERMISSIONS.CONTENT_START)
  listWeeks(@Param("id", ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    return this.contentService.listWeeks(id, req.user.id);
  }

  @Put(":id/weeks/:week_number/context")
  @Permissions(PERMISSIONS.CONTENT_START)
  upsertWeekContext(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("week_number", ParseIntPipe) weekNumber: number,
    @Req() req: RequestWithUser,
    @Body() dto: UpsertWeekContextDto,
  ) {
    return this.contentService.upsertWeekContext(id, weekNumber, dto, req.user.id);
  }

  @Post(":id/weeks/:week_number/generate")
  @Permissions(PERMISSIONS.CONTENT_START)
  generateWeek(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("week_number", ParseIntPipe) weekNumber: number,
    @Req() req: RequestWithUser,
    @Body() dto: GenerateContentWeekDto,
  ) {
    return this.contentService.generateWeek(id, weekNumber, dto, req.user.id);
  }
}

/**
 * Content lifecycle endpoints for content packs.
 *
 * Same guard stack and ownership model as the content-cycle controller:
 * authentication, `content:start` permission, per-owner rate limit, and
 * server-side ownership verification returning 404 on cross-owner access.
 */
@Controller("content-packs")
@UseGuards(JwtAuthGuard, PermissionsGuard, ContentRateLimitGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class ContentPackController {
  constructor(private readonly contentService: ContentService) {}

  @Get(":id")
  @Permissions(PERMISSIONS.CONTENT_START)
  getPack(@Param("id", ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    return this.contentService.getPack(id, req.user.id);
  }

  @Get(":id/progress")
  @Permissions(PERMISSIONS.CONTENT_START)
  getPackProgress(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentService.getPackProgress(id, req.user.id);
  }

  @Post(":id/retry")
  @Permissions(PERMISSIONS.CONTENT_START)
  retryPack(@Param("id", ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    return this.contentService.retryPack(id, req.user.id);
  }

  @Get(":id/items/:item_id/versions")
  @Permissions(PERMISSIONS.CONTENT_START)
  getItemVersions(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("item_id", ParseUUIDPipe) itemId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentService.getItemVersions(id, itemId, req.user.id);
  }

  @Post(":id/items/:item_id/decisions")
  @Permissions(PERMISSIONS.CONTENT_START)
  decide(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("item_id", ParseUUIDPipe) itemId: string,
    @Req() req: RequestWithUser,
    @Body() dto: ContentDecisionDto,
  ) {
    return this.contentService.decide(id, itemId, dto, req.user.id);
  }

  @Post(":id/decisions/bulk")
  @Permissions(PERMISSIONS.CONTENT_START)
  bulkDecide(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: BulkContentDecisionDto,
  ) {
    return this.contentService.bulkDecide(id, dto.decisions, req.user.id);
  }
}
