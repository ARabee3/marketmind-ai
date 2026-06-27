import { Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { Permission, ROLE_PERMISSIONS } from "./rbac.constants";

/**
 * Resolves a user's permissions from their roles.
 *
 * Resolution is a pure, in-memory lookup over {@link ROLE_PERMISSIONS} so that
 * protected routes never depend on the database being available. The roles are
 * taken from the authenticated JWT user (`req.user.roles`), which means the
 * decision is consistent wherever the access token is accepted.
 *
 * The union of permissions across all of the user's roles is used, so a user
 * with multiple roles accumulates permissions from each.
 */
@Injectable()
export class RbacService {
  /**
   * Returns the set of permissions granted by the given roles.
   *
   * The result is de-duplicated and sorted for stable comparison/testing.
   * Unknown roles are ignored so a future role value cannot break resolution.
   */
  resolvePermissions(roles: readonly Role[]): Permission[] {
    const granted = new Set<Permission>();

    for (const role of roles) {
      const perms = ROLE_PERMISSIONS[role];
      if (!perms) {
        continue;
      }
      for (const perm of perms) {
        granted.add(perm);
      }
    }

    return Array.from(granted).sort();
  }

  /**
   * Returns true when the roles grant every one of the required permissions
   * (AND semantics). An empty `required` list is treated as satisfied.
   */
  hasAllPermissions(
    roles: readonly Role[],
    required: readonly Permission[],
  ): boolean {
    if (required.length === 0) {
      return true;
    }
    const granted = this.resolvePermissions(roles);
    const grantedSet = new Set(granted);
    return required.every((perm) => grantedSet.has(perm));
  }

  /**
   * Returns true when the roles grant the single required permission.
   */
  hasPermission(roles: readonly Role[], required: Permission): boolean {
    return this.hasAllPermissions(roles, [required]);
  }
}
