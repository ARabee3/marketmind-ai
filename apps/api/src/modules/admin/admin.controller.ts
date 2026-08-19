import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { Permissions } from "../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { AuditService } from "../audit/audit.service";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.ADMIN_PLATFORM)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
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
}
