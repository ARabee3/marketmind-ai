import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { TargetsService } from "./targets.service";
import {
  CreateTargetDto,
  UpdateTargetConnectionStateDto,
  VerifyTargetDto,
} from "./targets.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { BusinessOwnershipGuard } from "../common/guards/business-ownership.guard";

@Controller("publishing-targets")
@UseGuards(JwtAuthGuard, BusinessOwnershipGuard)
export class TargetsController {
  constructor(private readonly targetsService: TargetsService) {}

  @Post()
  create(@Body() dto: CreateTargetDto, @Req() req: Record<string, unknown>) {
    // businessId is taken from the authenticated session, NOT the body, to
    // prevent cross-tenant injection (issue #119 G10). The body field is
    // ignored in favour of the session's businessId.
    const user = req["user"] as { businessId?: string };
    return this.targetsService.createTarget({
      ...dto,
      businessId: user.businessId!,
    });
  }

  @Get()
  list(@Req() req: Record<string, unknown>) {
    const user = req["user"] as { businessId?: string };
    return this.targetsService.listTargets(user.businessId!);
  }

  @Get(":targetId")
  getOne(
    @Param("targetId") targetId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId?: string };
    return this.targetsService.getTarget(targetId, user.businessId!);
  }

  @Patch(":targetId/connection")
  updateState(
    @Param("targetId") targetId: string,
    @Body() dto: UpdateTargetConnectionStateDto,
    @Req() req: Record<string, unknown>,
  ) {
    // Scope the connection-state mutation to the owning business — without
    // this, any authenticated user could flip another business's target
    // connection state (cross-tenant mutation, issue #119 G10).
    const user = req["user"] as { businessId?: string };
    return this.targetsService.updateConnectionState(
      targetId,
      user.businessId!,
      dto,
    );
  }

  @Post(":targetId/verify")
  verify(
    @Param("targetId") targetId: string,
    @Body() dto: VerifyTargetDto,
    @Req() req: Record<string, unknown>,
  ) {
    // Frozen contract route (PUBLISHING_CONTRACT.md). Ownership-scoped;
    // version-conflict guard prevents stale verification results.
    const user = req["user"] as { businessId?: string };
    return this.targetsService.verifyTarget(targetId, user.businessId!, dto);
  }

  @Delete(":targetId")
  async remove(
    @Param("targetId") targetId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId?: string };
    await this.targetsService.deleteTarget(targetId, user.businessId!);
    return { ok: true };
  }
}
