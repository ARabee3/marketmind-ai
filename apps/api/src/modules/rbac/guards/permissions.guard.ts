import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";

import { AuthenticatedUser } from "../../auth/interfaces/jwt-payload.interface";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { Permission } from "../rbac.constants";
import { RbacService } from "../rbac.service";

/**
 * Enforces the permissions declared by `@Permissions(...)` on a route.
 *
 * Must be placed **after** `JwtAuthGuard` (or any guard that populates
 * `req.user`) in the `@UseGuards(...)` chain:
 *
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *
 * Behaviour:
 *   - No `@Permissions` metadata  → passes (route is not permission-gated).
 *   - `req.user` missing           → 401 UnauthorizedException.
 *   - User lacks any required perm → 403 ForbiddenException (safe, no detail
 *     about which permission failed or what the user holds).
 *
 * Permission resolution is delegated to {@link RbacService} and is a pure
 * in-memory lookup over `ROLE_PERMISSIONS`, so this guard never hits the DB.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Route has no @Permissions decorator — nothing to enforce.
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      Request & { user?: AuthenticatedUser }
    >();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    const roles = user.roles ?? [];
    if (!this.rbacService.hasAllPermissions(roles, required)) {
      throw new ForbiddenException("Insufficient permissions");
    }

    return true;
  }
}
