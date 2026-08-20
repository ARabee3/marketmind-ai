import {
  BadRequestException,
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
import { Role, UserStatus } from "@prisma/client";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { Permissions } from "../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { AdminService } from "./admin.service";
import { AdminBillingService } from "./admin-billing.service";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";
import { TopUpWalletDto } from "./dto/top-up-wallet.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.ADMIN_PLATFORM)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminBillingService: AdminBillingService,
  ) {}

  @Get("users")
  async getUsers(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("search") search?: string,
    @Query("verified") verified?: string,
    @Query("role") role?: string,
    @Query("status") status?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? "1", 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize ?? "20", 10) || 20));
    const verifiedFilter =
      verified === "true" ? true : verified === "false" ? false : undefined;
    const roleFilter = parseOptionalEnum(role, Object.values(Role), "role");
    const statusFilter = parseOptionalEnum(
      status,
      Object.values(UserStatus),
      "status",
    );
    return this.adminService.getUsers(
      p,
      ps,
      search,
      verifiedFilter,
      roleFilter,
      statusFilter,
    );
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

  @Get("billing/wallets/overview")
  async getWalletOverview() {
    return this.adminBillingService.getWalletOverview();
  }

  @Get("billing/wallets")
  async getWalletBalances(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
  ) {
    return this.adminBillingService.listWalletBalances({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      search,
      status,
    });
  }

  @Get("billing/wallets/:id/ledger")
  async getWalletLedger(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminBillingService.getWalletLedger(id);
  }

  @Post("billing/wallets/:id/top-up")
  async topUpWallet(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TopUpWalletDto,
    @Req() req: Request,
  ) {
    const actor = req.user as AuthenticatedUser;
    return this.adminBillingService.topUpWallet(
      id,
      dto.points,
      dto.reason,
      actor.id,
      actor.email,
    );
  }

  @Get("billing/transactions")
  async getWalletTransactions(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("accountId") accountId?: string,
  ) {
    return this.adminBillingService.listWalletTransactions({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      accountId,
    });
  }
}

function parseOptionalEnum<T extends string>(
  value: string | undefined,
  values: readonly T[],
  name: string,
): T | undefined {
  if (!value) return undefined;
  if (!values.includes(value as T)) {
    throw new BadRequestException(`Invalid ${name} filter`);
  }
  return value as T;
}
