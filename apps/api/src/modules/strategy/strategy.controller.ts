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
import { StrategyRateLimitGuard } from "./strategy-rate-limit.guard";
import { StrategyService } from "./strategy.service";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { UpsertBriefDto } from "./dto/upsert-brief.dto";
import { OwnerDecisionDto } from "./dto/owner-decision.dto";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

/**
 * Strategy module endpoints.
 *
 * Every route requires authentication (JwtAuthGuard) and the
 * `strategy:start` permission (PermissionsGuard). Ownership is re-verified
 * server-side in the service via getStrategyByIdAndOwner, so a user can only
 * operate on strategies belonging to businesses they own — cross-business
 * access returns 404 rather than 403 to avoid leaking the existence of other
 * owners' strategies.
 */
@Controller("strategies")
@UseGuards(JwtAuthGuard, PermissionsGuard, StrategyRateLimitGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Post()
  @Permissions(PERMISSIONS.STRATEGY_START)
  createStrategy(@Req() req: RequestWithUser, @Body() dto: CreateStrategyDto) {
    return this.strategyService.createStrategy(dto, req.user.id);
  }

  @Put(":id/brief")
  @Permissions(PERMISSIONS.STRATEGY_START)
  updateBrief(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpsertBriefDto,
  ) {
    return this.strategyService.upsertBrief(id, req.user.id, dto);
  }

  @Post(":id/generate")
  @Permissions(PERMISSIONS.STRATEGY_START)
  generateStrategy(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.strategyService.startGeneration(id, req.user.id);
  }

  @Get(":id")
  @Permissions(PERMISSIONS.STRATEGY_START)
  getStrategy(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.strategyService.getStrategy(id, req.user.id);
  }

  @Get(":id/versions/:version")
  @Permissions(PERMISSIONS.STRATEGY_START)
  getStrategyVersion(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("version", ParseIntPipe) version: number,
    @Req() req: RequestWithUser,
  ) {
    return this.strategyService.getStrategyVersion(id, version, req.user.id);
  }

  @Get(":id/retrieval")
  @Permissions(PERMISSIONS.STRATEGY_START)
  getRetrievalPack(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.strategyService.getRetrievalPack(id, req.user.id);
  }

  @Post(":id/decisions")
  @Permissions(PERMISSIONS.STRATEGY_START)
  ownerDecision(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: OwnerDecisionDto,
  ) {
    return this.strategyService.handleDecision(id, req.user.id, dto);
  }

  @Post(":id/retry")
  @Permissions(PERMISSIONS.STRATEGY_START)
  retryGeneration(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.strategyService.retryGeneration(id, req.user.id);
  }
}