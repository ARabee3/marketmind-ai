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
  ReconnectMetaTargetDto,
  SelectMetaTargetsDto,
  VerifyTargetDto,
} from "./targets.dto";
import { MetaConnectionService } from "./meta-connection.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { BusinessOwnershipGuard } from "../common/guards/business-ownership.guard";

/**
 * Owner-facing publishing-target routes.
 *
 * Issue #175: the owner browser can NEVER create a CONNECTED target with an
 * arbitrary `credentialRef`. The provider OAuth boundary — `meta/connect`
 * proves account ownership and the API-owned `meta/callback` writes the
 * encrypted credential behind an opaque reference — is the ONLY path that
 * creates dispatchable rows. There is NO plain `POST /publishing-targets`
 * create and NO owner-side connection-state mutation; the owner surface is
 * list / get / verify / disconnect / delete, plus the safe connection journey
 * (connect → callback → pending selection → select → reconnect).
 */
@Controller("publishing-targets")
@UseGuards(JwtAuthGuard, BusinessOwnershipGuard)
export class TargetsController {
  constructor(
    private readonly targetsService: TargetsService,
    private readonly metaConnection: MetaConnectionService,
  ) {}

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

  /** Issue #175: live provider verification through the vault-backed
   *  credential. A failed verification becomes a blocked state truthfully. */
  @Post(":targetId/verify")
  verify(
    @Param("targetId") targetId: string,
    @Body() dto: VerifyTargetDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string; id: string };
    return this.metaConnection.verifyTargetLive({
      targetId,
      businessId: user.businessId,
      expectedVersion: dto.expectedTargetVersion,
      actorUserId: user.id,
    });
  }

  /** Issue #175: safe disconnect — cancels scheduled real intents, revokes the
   *  credential when unused, preserves a non-sensitive audit trail. */
  @Post(":targetId/disconnect")
  disconnect(
    @Param("targetId") targetId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string; id: string };
    return this.metaConnection.disconnectTarget({
      targetId,
      businessId: user.businessId,
      userId: user.id,
    });
  }

  @Delete(":targetId")
  async remove(
    @Param("targetId") targetId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string; id: string };
    await this.metaConnection.deleteTarget({
      targetId,
      businessId: user.businessId,
      userId: user.id,
    });
    return { ok: true };
  }

  /** Owner-authenticated initiation boundary — returns only the safe
   *  authorization URL + connection id. */
  @Post("meta/connect")
  connect(@Body() dto: ConnectMetaTargetDto, @Req() req: Record<string, unknown>) {
    const user = req["user"] as { businessId: string; id: string };
    return this.metaConnection.initiateConnect({
      businessId: user.businessId,
      userId: user.id,
      provider: dto.provider,
      channel: dto.channel,
      locale: dto.locale,
      returnPath: dto.returnPath,
      fingerprint: dto.fingerprint,
    });
  }

  /** Safe pending-account selection metadata (display metadata + blockers —
   *  never tokens). */
  @Get("meta/pending/:connectionId")
  pendingSelection(
    @Param("connectionId") connectionId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string; id: string };
    return this.metaConnection.getPendingSelection({
      businessId: user.businessId,
      userId: user.id,
      connectionId,
      fingerprint: String(req.headers?.["x-connection-fingerprint"] ?? ""),
    });
  }

  /** Creates CONNECTED targets only after live capability verification. */
  @Post("meta/select")
  select(
    @Body() dto: SelectMetaTargetsDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string; id: string };
    return this.metaConnection.selectTargets({
      businessId: user.businessId,
      userId: user.id,
      connectionId: dto.connectionId,
      pageId: dto.pageId,
      includeInstagram: dto.includeInstagram,
      fingerprint: dto.fingerprint,
    });
  }

  /** Explicit reconnect journey for an existing target. */
  @Post("meta/reconnect")
  reconnect(
    @Body() dto: ReconnectMetaTargetDto,
    @Req() req: Record<string, unknown>,
  ) {
    const user = req["user"] as { businessId: string; id: string };
    return this.metaConnection.reconnectTarget({
      businessId: user.businessId,
      userId: user.id,
      targetId: dto.targetId,
      locale: dto.locale,
      returnPath: dto.returnPath,
      fingerprint: dto.fingerprint,
    });
  }
}
