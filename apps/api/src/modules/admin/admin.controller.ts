import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { Permissions } from "../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { AuditService } from "../audit/audit.service";
import { AdminService } from "./admin.service";
import { AdminBillingService } from "./admin-billing.service";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";
import { PauseAccountDto } from "./dto/pause-account.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.ADMIN_PLATFORM)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminBillingService: AdminBillingService,
    private readonly auditService: AuditService,
  ) {}

  @Get("users")
  async getUsers(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("search") search?: string,
    @Query("verified") verified?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? "1", 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize ?? "20", 10) || 20));
    const verifiedFilter =
      verified === "true" ? true : verified === "false" ? false : undefined;
    return this.adminService.getUsers(p, ps, search, verifiedFilter);
  }

  @Get("users/:id")
  async getUserById(@Param("id", ParseUUIDPipe) id: string) {
    const detail = await this.adminService.getUserById(id);
    if (!detail) throw new NotFoundException();
    return detail;
  }

  @Patch("users/:id")
  async updateUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
    @Req() req: Request,
  ) {
    const actor = req.user as AuthenticatedUser;
    return this.adminService.updateUser(id, dto, actor.id, actor.email);
  }

  @Get("revenue/summary")
  async getRevenueSummary() {
    return this.adminService.getRevenueSummary();
  }

  @Get("subscriptions")
  async getSubscriptions(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("state") state?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? "1", 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize ?? "20", 10) || 20));
    return this.adminService.getSubscriptions(p, ps, state);
  }

  @Get("audit")
  async getAuditLogs(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("actor") actor?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? "1", 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize ?? "20", 10) || 20));
    return this.auditService.list({
      page: p,
      pageSize: ps,
      actor,
      action,
      from,
      to,
    });
  }

  @Get("billing/cost-alerts")
  async getCostAlerts() {
    return this.adminBillingService.listCostAlerts();
  }

  @Get("billing/reconciliation")
  async getReconciliationMismatches() {
    return this.adminBillingService.listReconciliationMismatches();
  }

  @Post("billing/accounts/:id/pause")
  async pauseAccount(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PauseAccountDto,
    @Req() req: Request,
  ) {
    const actor = req.user as AuthenticatedUser;
    return this.adminBillingService.pauseAccount(id, dto.reason, actor.id, actor.email);
  }

  @Post("billing/accounts/:id/resume")
  async resumeAccount(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const actor = req.user as AuthenticatedUser;
    return this.adminBillingService.resumeAccount(id, actor.id, actor.email);
  }
}
