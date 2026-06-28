import { SetMetadata } from "@nestjs/common";

import { Permission } from "../rbac.constants";

/**
 * Metadata key under which the required permissions are stored on a handler.
 */
export const PERMISSIONS_KEY = "permissions";

/**
 * Declares the permissions required to access a route.
 *
 * Semantics are AND: the caller must hold *every* listed permission. The
 * {@link PermissionsGuard} reads this metadata and enforces it after the
 * `JwtAuthGuard` has populated `req.user`.
 *
 * Usage:
 *
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   @Permissions(PERMISSIONS.DISCOVERY_START)
 *   @Post("discovery/start")
 *
 * The guard is placed after `JwtAuthGuard` so that `req.user` is available.
 */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
