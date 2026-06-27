import { Role } from "@prisma/client";

/**
 * Canonical permissions recognised by the RBAC layer.
 *
 * A permission is the smallest unit of access. Routes declare the permission
 * they require via `@Permissions(...)`; the `PermissionsGuard` checks that the
 * authenticated user holds every required permission.
 *
 * These string values are also stored verbatim in the `permissions` table by
 * the seed script, so the DB rows and the in-memory resolver never drift.
 */
export const PERMISSIONS = {
  BUSINESS_READ: "business:read",
  BUSINESS_UPDATE: "business:update",
  DISCOVERY_START: "discovery:start",
  DISCOVERY_CONTINUE: "discovery:continue",
  DISCOVERY_CONFIRM_PROFILE: "discovery:confirm_profile",
  STRATEGY_START: "strategy:start",
  ADMIN_MANAGE_LIBRARY: "admin:manage_library",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All permissions, useful for seeding and super-user resolution. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/**
 * Permissions granted to the `owner` role.
 *
 * The owner can run the full product journey (business, discovery, strategy)
 * but cannot manage the admin library.
 */
const OWNER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.BUSINESS_READ,
  PERMISSIONS.BUSINESS_UPDATE,
  PERMISSIONS.DISCOVERY_START,
  PERMISSIONS.DISCOVERY_CONTINUE,
  PERMISSIONS.DISCOVERY_CONFIRM_PROFILE,
  PERMISSIONS.STRATEGY_START,
];

/**
 * Role -> permission mapping.
 *
 * Single source of truth for permission resolution. The `PermissionsGuard`
 * reads roles from the authenticated JWT user (`req.user.roles`) and expands
 * them through this map; the union of permissions across all roles is used.
 *
 *   owner          — full product access except admin library management.
 *   admin          — all owner permissions plus `admin:manage_library`.
 *   developer_demo — read-only plus starting/continuing discovery; no updates,
 *                    no profile confirmation, no strategy, no admin actions.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.OWNER]: OWNER_PERMISSIONS,
  [Role.ADMIN]: [...OWNER_PERMISSIONS, PERMISSIONS.ADMIN_MANAGE_LIBRARY],
  [Role.DEVELOPER_DEMO]: [
    PERMISSIONS.BUSINESS_READ,
    PERMISSIONS.DISCOVERY_START,
    PERMISSIONS.DISCOVERY_CONTINUE,
  ],
};
