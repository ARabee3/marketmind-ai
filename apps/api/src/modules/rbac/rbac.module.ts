import { Module } from "@nestjs/common";

/**
 * RbacModule — placeholder for Sprint 1.
 *
 * Will contain:
 * - RbacService: permission resolution.
 * - PermissionsGuard: route-level permission enforcement.
 * - @Permissions() decorator for controller methods.
 *
 * Initial roles: owner, admin, developer_demo.
 * Initial permissions: business:read, business:update, discovery:start,
 *   discovery:continue, discovery:confirm_profile, strategy:start,
 *   admin:manage_library.
 *
 * Implementation is owned by Gerges (Issue #6).
 */
@Module({})
export class RbacModule {}
