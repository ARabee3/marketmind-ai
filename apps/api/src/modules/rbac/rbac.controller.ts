import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";

import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Permissions } from "./decorators/permissions.decorator";
import { PermissionsGuard } from "./guards/permissions.guard";
import { PERMISSIONS, PUBLIC_ROLE_NAMES } from "./rbac.constants";
import { RbacService } from "./rbac.service";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

/**
 * RbacController — exposes current-user permission resolution and a small
 * demo route protected by `@Permissions(...)`.
 *
 * Endpoints:
 *   GET /api/v1/rbac/me/permissions
 *       Auth required (JwtAuthGuard). Returns the caller's roles and the
 *       permissions resolved from them. Lets the frontend and tests verify
 *       that "owner permissions are returned correctly".
 *
 *   GET /api/v1/rbac/demo/business-read
 *       Auth + `business:read` permission required. Proves the
 *       guard/decorator pattern enforces a permission end-to-end. Other demo
 *       permissions can be added the same way when Discovery/Strategy land.
 */
@Controller("rbac")
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get("me/permissions")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  mePermissions(@Req() req: RequestWithUser): {
    roles: string[];
    permissions: string[];
  } {
    return {
      roles: req.user.roles.map((role) => PUBLIC_ROLE_NAMES[role]),
      permissions: this.rbacService.resolvePermissions(req.user.roles),
    };
  }

  @Get("demo/business-read")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(PERMISSIONS.BUSINESS_READ)
  @HttpCode(HttpStatus.OK)
  demoBusinessRead(): { status: "allowed"; permission: string } {
    return {
      status: "allowed",
      permission: PERMISSIONS.BUSINESS_READ,
    };
  }
}
