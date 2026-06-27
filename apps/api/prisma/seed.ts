import { PrismaClient, Role } from "@prisma/client";

import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
} from "../src/modules/rbac/rbac.constants";

/**
 * Prisma seed script.
 *
 * Seeds the normalised RBAC tables (`roles`, `permissions`,
 * `role_permissions`) so they stay consistent with the in-memory
 * `ROLE_PERMISSIONS` map used by `RbacService`. The seed is idempotent and
 * safe to re-run: it runs in a single transaction and reconciles each table
 * against the in-memory policy, removing permissions and role-permission
 * links that no longer exist in `ROLE_PERMISSIONS` / `ALL_PERMISSIONS`.
 *
 * Run with: npm run prisma:seed
 */
const prisma = new PrismaClient();

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [Role.OWNER]:
    "Business owner — full product journey, no admin library management.",
  [Role.ADMIN]:
    "Platform admin — all owner permissions plus admin library management.",
  [Role.DEVELOPER_DEMO]:
    "Demo developer — read-only plus starting and continuing discovery.",
};

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [PERMISSIONS.BUSINESS_READ]: "Read business profile and related data.",
  [PERMISSIONS.BUSINESS_UPDATE]: "Update business profile and related data.",
  [PERMISSIONS.DISCOVERY_START]: "Start a Prepared Discovery session.",
  [PERMISSIONS.DISCOVERY_CONTINUE]:
    "Continue a Discovery interview (respond and summarize).",
  [PERMISSIONS.DISCOVERY_CONFIRM_PROFILE]:
    "Confirm a Discovery business profile draft.",
  [PERMISSIONS.STRATEGY_START]: "Start a strategy generation flow.",
  [PERMISSIONS.ADMIN_MANAGE_LIBRARY]: "Manage the admin content library.",
};

async function main() {
  // The seed reconciles the normalised RBAC tables against the in-memory
  // policy (ALL_PERMISSIONS / ROLE_PERMISSIONS) in a single transaction so
  // the database stays consistent even when the policy is tightened and the
  // seed is re-run: stale permission rows and stale role-permission links are
  // removed, not just new ones upserted.
  await prisma.$transaction(async (tx) => {
    // 1. Permissions (single source: ALL_PERMISSIONS). Upsert every current
    //    permission, then delete any row no longer in the policy. Deleting a
    //    Permission cascades to its RolePermission links (schema
    //    onDelete: Cascade).
    const permissionIds: Record<string, string> = {};
    for (const name of ALL_PERMISSIONS) {
      const permission = await tx.permission.upsert({
        where: { name },
        update: { description: PERMISSION_DESCRIPTIONS[name] ?? null },
        create: { name, description: PERMISSION_DESCRIPTIONS[name] ?? null },
        select: { id: true },
      });
      permissionIds[name] = permission.id;
    }
    await tx.permission.deleteMany({
      where: { name: { notIn: [...ALL_PERMISSIONS] } },
    });

    // 2. Roles and their role-permission links (single source:
    //    ROLE_PERMISSIONS, the same map the RbacService resolves against).
    //    For each role we replace its links transactionally: delete every
    //    existing link, then recreate exactly the links the policy declares.
    //    This covers the tighten-then-rerun case, where a permission was
    //    removed from a role's list and the old link must not survive.
    for (const [roleKey, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await tx.roleEntity.upsert({
        where: { name: roleKey as Role },
        update: { description: ROLE_DESCRIPTIONS[roleKey as Role] ?? null },
        create: {
          name: roleKey as Role,
          description: ROLE_DESCRIPTIONS[roleKey as Role] ?? null,
        },
        select: { id: true },
      });

      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });

      for (const permName of perms) {
        const permissionId = permissionIds[permName];
        if (!permissionId) {
          throw new Error(
            `Permission "${permName}" not found while seeding role "${roleKey}"`,
          );
        }
        await tx.rolePermission.create({
          data: { roleId: role.id, permissionId },
        });
      }
    }
  });

  console.log(
    "Seeded RBAC: 3 roles, 7 permissions, and role-permission mappings.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
