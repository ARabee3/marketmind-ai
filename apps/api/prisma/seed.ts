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
 * safe to re-run: it upserts every row by its unique key.
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
  // 1. Upsert all permissions (single source: ALL_PERMISSIONS).
  for (const name of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name },
      update: { description: PERMISSION_DESCRIPTIONS[name] ?? null },
      create: { name, description: PERMISSION_DESCRIPTIONS[name] ?? null },
    });
  }

  // 2. Upsert roles and their role-permission links (single source:
  //    ROLE_PERMISSIONS, the same map the RbacService resolves against).
  for (const [roleKey, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.roleEntity.upsert({
      where: { name: roleKey as Role },
      update: { description: ROLE_DESCRIPTIONS[roleKey as Role] ?? null },
      create: {
        name: roleKey as Role,
        description: ROLE_DESCRIPTIONS[roleKey as Role] ?? null,
      },
    });

    for (const permName of perms) {
      const permission = await prisma.permission.findUnique({
        where: { name: permName },
      });
      if (!permission) {
        throw new Error(
          `Permission "${permName}" not found while seeding role "${roleKey}"`,
        );
      }
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

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
