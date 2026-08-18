import {
  Controller,
  Body,
  BadRequestException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../../auth/interfaces/jwt-payload.interface";
import { Permissions } from "../../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../../rbac/rbac.constants";
import { GenerateOptimizationProposalDto } from "./dto/generate-optimization-proposal.dto";
import { OptimizationService } from "./optimization.service";

type RequestWithUser = Request & { user: AuthenticatedUser };

/** Owner-scoped, suggest-only Optimization 1 API. */
@Controller("performance/optimization")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.BUSINESS_READ)
export class OptimizationController {
  constructor(private readonly optimization: OptimizationService) {}

  @Get("readiness")
  readiness(@Req() req: RequestWithUser, @Query("format") format?: string) {
    if (format && !["text_post", "static_image_post"].includes(format)) {
      throw new BadRequestException({
        code: "OPTIMIZATION_INVALID_FORMAT",
        message: "format must be text_post or static_image_post",
      });
    }
    return this.optimization.readiness(
      req.user.id,
      format as "text_post" | "static_image_post" | undefined,
    );
  }

  @Post("proposals")
  generate(
    @Req() req: RequestWithUser,
    @Body() dto: GenerateOptimizationProposalDto,
  ) {
    return this.optimization.generate(req.user.id, dto);
  }

  @Get("proposals")
  list(@Req() req: RequestWithUser) {
    return this.optimization.list(req.user.id);
  }

  @Get("proposals/:proposalId")
  get(
    @Req() req: RequestWithUser,
    @Param("proposalId", ParseUUIDPipe) proposalId: string,
  ) {
    return this.optimization.get(req.user.id, proposalId);
  }
}
