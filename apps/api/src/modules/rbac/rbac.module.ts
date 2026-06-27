import { Global, Module } from "@nestjs/common";

import { RbacService } from "./rbac.service";

/**
 * RbacModule — role/permission resolution and route protection.
 *
 * Marked `@Global()` so that feature modules (Discovery, Strategy, ...) can
 * use `PermissionsGuard` and `RbacService` without importing this module in
 * each one. Resolution is a pure in-memory lookup over `ROLE_PERMISSIONS`;
 * this module has no database dependency.
 *
 * Public providers:
 *   - `RbacService`          — resolve a user's permissions from their roles.
 *
 * Guards/decorators live alongside this module and are exported implicitly as
 * they are framework primitives (no DI provider needed for the decorator; the
 * guard is used via `@UseGuards`).
 */
@Global()
@Module({
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
