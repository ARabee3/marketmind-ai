import { Test, TestingModule } from "@nestjs/testing";
import { Role } from "@prisma/client";

import { RbacService } from "./rbac.service";
import { PERMISSIONS } from "./rbac.constants";

describe("RbacService", () => {
  let service: RbacService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RbacService],
    }).compile();

    service = module.get<RbacService>(RbacService);
  });

  // =========================================================================
  // resolvePermissions()
  // =========================================================================

  describe("resolvePermissions()", () => {
    it("should return the owner permissions for the owner role", () => {
      const result = service.resolvePermissions([Role.OWNER]);

      expect(result).toEqual(
        [
          PERMISSIONS.BUSINESS_READ,
          PERMISSIONS.BUSINESS_UPDATE,
          PERMISSIONS.DISCOVERY_START,
          PERMISSIONS.DISCOVERY_CONTINUE,
          PERMISSIONS.DISCOVERY_CONFIRM_PROFILE,
          PERMISSIONS.STRATEGY_START,
        ].sort(),
      );
      // owner must NOT have admin library management
      expect(result).not.toContain(PERMISSIONS.ADMIN_MANAGE_LIBRARY);
    });

    it("should return all permissions for the admin role", () => {
      const result = service.resolvePermissions([Role.ADMIN]);

      expect(result).toEqual(
        [
          PERMISSIONS.BUSINESS_READ,
          PERMISSIONS.BUSINESS_UPDATE,
          PERMISSIONS.DISCOVERY_START,
          PERMISSIONS.DISCOVERY_CONTINUE,
          PERMISSIONS.DISCOVERY_CONFIRM_PROFILE,
          PERMISSIONS.STRATEGY_START,
          PERMISSIONS.ADMIN_MANAGE_LIBRARY,
        ].sort(),
      );
    });

    it("should return only the limited developer_demo permissions", () => {
      const result = service.resolvePermissions([Role.DEVELOPER_DEMO]);

      expect(result).toEqual(
        [
          PERMISSIONS.BUSINESS_READ,
          PERMISSIONS.DISCOVERY_START,
          PERMISSIONS.DISCOVERY_CONTINUE,
        ].sort(),
      );
      // developer_demo must NOT be able to update, confirm, start strategy, or admin
      expect(result).not.toContain(PERMISSIONS.BUSINESS_UPDATE);
      expect(result).not.toContain(PERMISSIONS.DISCOVERY_CONFIRM_PROFILE);
      expect(result).not.toContain(PERMISSIONS.STRATEGY_START);
      expect(result).not.toContain(PERMISSIONS.ADMIN_MANAGE_LIBRARY);
    });

    it("should union permissions when multiple roles are present", () => {
      // owner + developer_demo should equal owner (developer_demo is a subset)
      const result = service.resolvePermissions([
        Role.OWNER,
        Role.DEVELOPER_DEMO,
      ]);

      const ownerPerms = service.resolvePermissions([Role.OWNER]);
      expect(result).toEqual(ownerPerms);
    });

    it("should union permissions across owner and admin without duplicates", () => {
      const result = service.resolvePermissions([Role.OWNER, Role.ADMIN]);

      // admin already includes owner, so the union equals admin's set
      expect(result).toEqual(service.resolvePermissions([Role.ADMIN]));
      // no duplicate entries
      expect(new Set(result).size).toBe(result.length);
    });

    it("should return an empty array for an empty roles list", () => {
      expect(service.resolvePermissions([])).toEqual([]);
    });

    it("should ignore unknown role values without throwing", () => {
      // Simulate a role value that is not in the map (e.g. a future role).
      const unknown = "superuser" as unknown as Role;
      expect(() => service.resolvePermissions([unknown])).not.toThrow();
      expect(service.resolvePermissions([unknown])).toEqual([]);
    });
  });

  // =========================================================================
  // hasPermission() / hasAllPermissions()
  // =========================================================================

  describe("hasPermission()", () => {
    it("should return true when the role grants the permission", () => {
      expect(
        service.hasPermission([Role.OWNER], PERMISSIONS.DISCOVERY_START),
      ).toBe(true);
    });

    it("should return false when the role does not grant the permission", () => {
      expect(
        service.hasPermission(
          [Role.DEVELOPER_DEMO],
          PERMISSIONS.DISCOVERY_CONFIRM_PROFILE,
        ),
      ).toBe(false);
    });

    it("should return false for owner asking for admin:manage_library", () => {
      expect(
        service.hasPermission([Role.OWNER], PERMISSIONS.ADMIN_MANAGE_LIBRARY),
      ).toBe(false);
    });

    it("should return true for admin asking for admin:manage_library", () => {
      expect(
        service.hasPermission([Role.ADMIN], PERMISSIONS.ADMIN_MANAGE_LIBRARY),
      ).toBe(true);
    });

    it("should return false for an empty roles list", () => {
      expect(
        service.hasPermission([], PERMISSIONS.BUSINESS_READ),
      ).toBe(false);
    });
  });

  describe("hasAllPermissions()", () => {
    it("should return true when all required permissions are granted", () => {
      expect(
        service.hasAllPermissions([Role.OWNER], [
          PERMISSIONS.BUSINESS_READ,
          PERMISSIONS.DISCOVERY_START,
        ]),
      ).toBe(true);
    });

    it("should return false when any one required permission is missing", () => {
      expect(
        service.hasAllPermissions([Role.DEVELOPER_DEMO], [
          PERMISSIONS.BUSINESS_READ, // granted
          PERMISSIONS.DISCOVERY_CONFIRM_PROFILE, // not granted
        ]),
      ).toBe(false);
    });

    it("should return true when the required list is empty", () => {
      expect(service.hasAllPermissions([Role.OWNER], [])).toBe(true);
      expect(service.hasAllPermissions([], [])).toBe(true);
    });

    it("should return false when roles are empty but permissions are required", () => {
      expect(
        service.hasAllPermissions([], [PERMISSIONS.BUSINESS_READ]),
      ).toBe(false);
    });
  });
});
