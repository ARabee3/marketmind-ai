import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import type {
  ContentCtaDestination,
  OwnerContentDirectEditRequest,
} from "@marketmind/contracts";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../../auth/interfaces/jwt-payload.interface";
import { Permissions } from "../../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../../rbac/rbac.constants";
import { ContentRateLimitGuard } from "../content-rate-limit.guard";
import { ContentV2Service } from "./content-v2.service";
import {
  CreateCtaEntryDto,
  CreateOrReplaceWeekPlanDto,
  OwnerContentDirectEditDto,
  RewriteContentItemDto,
  UpdateCtaEntryDto,
  UpsertEditorialProfileDto,
} from "./dto/content-v2.dto";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

/**
 * Content v2 endpoints (issue #187) — owner-first weekly studio.
 *
 * Same auth/ownership posture as the v1 controllers: JWT + permission +
 * per-owner rate limit, and every read re-verifies cycle ownership. No route
 * here schedules or publishes; approval continues through the existing
 * PublicationCandidateV1 boundary.
 */
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard, ContentRateLimitGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class ContentV2Controller {
  constructor(private readonly contentV2Service: ContentV2Service) {}

  // -------------------------------------------------------------------------
  // Cycle workspace aggregate
  // -------------------------------------------------------------------------

  @Get("content-cycles/:id/workspace")
  @Permissions(PERMISSIONS.CONTENT_START)
  getCycleWorkspace(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.getCycleWorkspace(id, req.user.id);
  }

  // -------------------------------------------------------------------------
  // Editorial profile
  // -------------------------------------------------------------------------

  @Get("content-cycles/:id/editorial-profile")
  @Permissions(PERMISSIONS.CONTENT_START)
  getEditorialProfile(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.getEditorialProfile(id, req.user.id);
  }

  @Patch("content-cycles/:id/editorial-profile")
  @Permissions(PERMISSIONS.CONTENT_START)
  upsertEditorialProfile(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpsertEditorialProfileDto,
  ) {
    return this.contentV2Service.upsertEditorialProfile(
      id,
      {
        contentCycleId: id,
        audienceNuance: dto.audience_nuance,
        voice: dto.voice,
        language: dto.language,
        writingGuardrails: dto.writing_guardrails,
        defaultVisualGuidance: dto.default_visual_guidance ?? null,
      },
      req.user.id,
    );
  }

  // -------------------------------------------------------------------------
  // CTA library
  // -------------------------------------------------------------------------

  @Get("content-cycles/:id/cta-library")
  @Permissions(PERMISSIONS.CONTENT_START)
  listCtaEntries(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.listCtaEntries(id, req.user.id);
  }

  @Post("content-cycles/:id/cta-library")
  @Permissions(PERMISSIONS.CONTENT_START)
  createCtaEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: CreateCtaEntryDto,
  ) {
    return this.contentV2Service.createCtaEntry(
      id,
      {
        contentCycleId: id,
        label: dto.label,
        destination: dto.destination as unknown as ContentCtaDestination,
        campaignContext: dto.campaign_context ?? null,
        active: dto.active ?? true,
      },
      req.user.id,
    );
  }

  @Patch("content-cycles/:id/cta-library/:entry_id")
  @Permissions(PERMISSIONS.CONTENT_START)
  updateCtaEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("entry_id", ParseUUIDPipe) entryId: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpdateCtaEntryDto,
  ) {
    return this.contentV2Service.updateCtaEntry(id, entryId, req.user.id, {
      ...(dto.label !== undefined ? { label: dto.label } : {}),
      ...(dto.destination !== undefined
        ? { destination: dto.destination as unknown as ContentCtaDestination }
        : {}),
      ...(dto.campaign_context !== undefined
        ? { campaignContext: dto.campaign_context }
        : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    });
  }

  @Post("content-cycles/:id/cta-library/:entry_id/deactivate")
  @Permissions(PERMISSIONS.CONTENT_START)
  deactivateCtaEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("entry_id", ParseUUIDPipe) entryId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.deactivateCtaEntry(id, entryId, req.user.id);
  }

  // -------------------------------------------------------------------------
  // Media library
  // -------------------------------------------------------------------------

  @Get("content-cycles/:id/media")
  @Permissions(PERMISSIONS.CONTENT_START)
  listMedia(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.listMedia(id, req.user.id);
  }

  @Post("content-cycles/:id/media")
  @Permissions(PERMISSIONS.CONTENT_START)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  uploadMedia(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException("A media file is required.");
    }
    return this.contentV2Service.uploadMedia(
      id,
      req.user.id,
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }

  @Get("content-cycles/:id/media/:media_id")
  @Permissions(PERMISSIONS.CONTENT_START)
  getMedia(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("media_id", ParseUUIDPipe) mediaId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.getMedia(id, mediaId, req.user.id);
  }

  @Post("content-cycles/:id/media/:media_id/revoke")
  @Permissions(PERMISSIONS.CONTENT_START)
  revokeMedia(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("media_id", ParseUUIDPipe) mediaId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.revokeMedia(id, mediaId, req.user.id);
  }

  // -------------------------------------------------------------------------
  // Week plans
  // -------------------------------------------------------------------------

  @Get("content-cycles/:id/weeks/:week_number/plan")
  @Permissions(PERMISSIONS.CONTENT_START)
  getWeekPlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("week_number", ParseIntPipe) weekNumber: number,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.getWeekPlan(id, weekNumber, req.user.id);
  }

  @Put("content-cycles/:id/weeks/:week_number/plan")
  @Permissions(PERMISSIONS.CONTENT_START)
  createOrReplaceWeekPlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("week_number", ParseIntPipe) weekNumber: number,
    @Req() req: RequestWithUser,
    @Body() dto: CreateOrReplaceWeekPlanDto,
  ) {
    return this.contentV2Service.createOrReplaceWeekPlan(
      id,
      weekNumber,
      dto.post_plans.map((plan) => ({
        position: plan.position,
        purpose: plan.purpose,
        intendedAudience: plan.intended_audience ?? null,
        channel: plan.channel,
        format: plan.format,
        ctaLibraryEntryId: plan.cta_library_entry_id,
        ownerInstructions: plan.owner_instructions ?? null,
        visualDirection: plan.visual_direction ?? null,
        selectedMediaIds: plan.selected_media_ids,
        source: "owner" as const,
      })),
      req.user.id,
    );
  }

  @Get("content-cycles/:id/week-plans")
  @Permissions(PERMISSIONS.CONTENT_START)
  listWeekPlans(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.listWeekPlans(id, req.user.id);
  }

  @Post("content-cycles/:id/weeks/:week_number/plan")
  @Permissions(PERMISSIONS.CONTENT_START)
  planWeek(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("week_number", ParseIntPipe) weekNumber: number,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.planWeek(id, weekNumber, req.user.id);
  }

  // -------------------------------------------------------------------------
  // Pack workspace + owner direct edit
  // -------------------------------------------------------------------------

  @Get("content-packs/:id/workspace")
  @Permissions(PERMISSIONS.CONTENT_START)
  getPackWorkspace(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.contentV2Service.getPackWorkspace(id, req.user.id);
  }

  @Post("content-packs/:id/items/:item_id/edits")
  @Permissions(PERMISSIONS.CONTENT_START)
  directEdit(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("item_id", ParseUUIDPipe) itemId: string,
    @Req() req: RequestWithUser,
    @Body() dto: OwnerContentDirectEditDto,
  ) {
    return this.contentV2Service.directEdit(
      id,
      itemId,
      dto as unknown as OwnerContentDirectEditRequest,
      req.user.id,
    );
  }

  @Post("content-packs/:id/items/:item_id/rewrite")
  @Permissions(PERMISSIONS.CONTENT_START)
  rewriteItem(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("item_id", ParseUUIDPipe) itemId: string,
    @Req() req: RequestWithUser,
    @Body() dto: RewriteContentItemDto,
  ) {
    return this.contentV2Service.rewriteItem(id, itemId, dto, req.user.id);
  }
}
