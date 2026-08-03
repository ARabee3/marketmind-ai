import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { TargetsService } from "./targets.service";
import {
  ConnectMetaTargetDto,
  MetaCallbackDto,
  VerifyTargetDto,
} from "./targets.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { BusinessOwnershipGuard } from "../common/guards/business-ownership.guard";

/**
 * Owner-facing publishing-target routes.
 *
 * P1 (#119 review): the owner browser CANNOT create a CONNECTED target with an
 * arbitrary `credentialRef`. The frozen flow requires the provider OAuth
 * boundary — `meta/connect` proves account ownership and `meta/callback` writes
 * the opaque credential reference — before a row becomes dispatchable. There is
 * NO plain `POST /publishing-targets` create and NO owner-side connection-state
 * mutation; the owner surface is list / get / verify / delete, plus initiating
 * the OAuth boundary. Real Meta OAuth lands in #120/#122 — until then meta/*
 * surfaces a clear 501 instead of fabricating a credential connection.
 */
@Controller("publishing-targets")
@UseGuards(JwtAuthGuard, BusinessOwnershipGuard)
export class TargetsController {
  constructor(private readonly targetsService: TargetsService) {}

  @Get()
  list(@Req() req: Record<string, unknown>) {
    const user = req["user"] as { businessId: string };
    return this.targetsService.listTargets(user.businessId);
  }

  @Get(":targetId")
  getOne(
    @Param("targetId") targetId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.targetsService.getTarget(targetId, user.businessId);
  }

  /** Frozen contract route (PUBLISHING_CONTRACT.md). Ownership-scoped;
   *  version-conflict guard prevents stale verification results. */
  @Post(":targetId/verify")
  verify(
    @Param("targetId") targetId: string,
    @Body() dto: VerifyTargetDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    return this.targetsService.verifyTarget(targetId, user.businessId, dto);
  }

  @Delete(":targetId")
  async remove(
    @Param("targetId") targetId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string };
    await this.targetsService.deleteTarget(targetId, user.businessId);
    return { ok: true };
  }

  /** Frozen provider OAuth boundary — initiate account-ownership proof. */
  @Post("meta/connect")
  connect(@Body() dto: ConnectMetaTargetDto, @Req() req: Record<string, unknown>) {
    const user = req["user"] as { businessId: string };
    return this.targetsService.connectMetaTarget(
      user.businessId,
      dto.provider,
      dto.channel,
    );
  }

  /** Frozen provider OAuth boundary — complete the OAuth redirect and create the
   *  CONNECTED target with the provider-derived credential reference. */
  @Post("meta/callback")
  callback(@Body() dto: MetaCallbackDto, @Req() req: Record<string, unknown>) {
    const user = req["user"] as { businessId: string };
    return this.targetsService.completeMetaCallback(
      user.businessId,
      dto.provider,
      dto.channel,
      dto.code,
      dto.state,
    );
  }
}