import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";

import { PermissionsGuard } from "./permissions.guard";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { PERMISSIONS } from "../rbac.constants";
import { RbacService } from "../rbac.service";

/**
 * Builds a mock ExecutionContext with a configurable `req.user` and an
 * optional value returned for the permissions metadata key.
 */
const createMockContext = (
  user: { roles: Role[] } | undefined,
  metadataPermissions: string[] | undefined,
): ExecutionContext => {
  const request: { user?: { roles: Role[] } } = {};
  if (user !== undefined) {
    request.user = user;
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => "handler",
    getClass: () => "controller",
  } as unknown as ExecutionContext;
};

const createMockReflector = (returnValue: string[] | undefined) => {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, "getAllAndOverride")
    .mockImplementation((key: string) =>
      key === PERMISSIONS_KEY ? returnValue : undefined,
    );
  return reflector;
};

describe("PermissionsGuard", () => {
  let rbacService: { hasAllPermissions: jest.Mock };

  beforeEach(() => {
    rbacService = { hasAllPermissions: jest.fn() };
  });

  /** Helper: build a guard wired to the shared rbacService mock. */
  const buildGuard = (metadataPermissions: string[] | undefined) =>
    new PermissionsGuard(
      createMockReflector(metadataPermissions),
      rbacService as unknown as RbacService,
    );

  it("should allow when no @Permissions metadata is present", () => {
    const guard = buildGuard(undefined);
    const ctx = createMockContext({ roles: [Role.OWNER] }, undefined);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(rbacService.hasAllPermissions).not.toHaveBeenCalled();
  });

  it("should allow when @Permissions is an empty list", () => {
    const guard = buildGuard([]);
    const ctx = createMockContext({ roles: [Role.OWNER] }, []);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(rbacService.hasAllPermissions).not.toHaveBeenCalled();
  });

  it("should allow when RbacService confirms the required permissions", () => {
    rbacService.hasAllPermissions.mockReturnValue(true);
    const guard = buildGuard([PERMISSIONS.DISCOVERY_START]);
    const ctx = createMockContext(
      { roles: [Role.OWNER] },
      [PERMISSIONS.DISCOVERY_START],
    );

    expect(guard.canActivate(ctx)).toBe(true);
    expect(rbacService.hasAllPermissions).toHaveBeenCalledWith(
      [Role.OWNER],
      [PERMISSIONS.DISCOVERY_START],
    );
  });

  it("should throw ForbiddenException when a required permission is missing", () => {
    rbacService.hasAllPermissions.mockReturnValue(false);
    const guard = buildGuard([PERMISSIONS.ADMIN_MANAGE_LIBRARY]);
    const ctx = createMockContext(
      { roles: [Role.OWNER] },
      [PERMISSIONS.ADMIN_MANAGE_LIBRARY],
    );

    expect(() => guard.canActivate(ctx)).toThrow("Insufficient permissions");
  });

  it("should throw UnauthorizedException when req.user is missing", () => {
    const guard = buildGuard([PERMISSIONS.BUSINESS_READ]);
    const ctx = createMockContext(undefined, [PERMISSIONS.BUSINESS_READ]);

    expect(() => guard.canActivate(ctx)).toThrow("Authentication required");
    expect(rbacService.hasAllPermissions).not.toHaveBeenCalled();
  });

  it("should reject when the user has no roles and a permission is required", () => {
    rbacService.hasAllPermissions.mockReturnValue(false);
    const guard = buildGuard([PERMISSIONS.BUSINESS_READ]);
    const ctx = createMockContext({ roles: [] }, [PERMISSIONS.BUSINESS_READ]);

    expect(() => guard.canActivate(ctx)).toThrow("Insufficient permissions");
    expect(rbacService.hasAllPermissions).toHaveBeenCalledWith(
      [],
      [PERMISSIONS.BUSINESS_READ],
    );
  });
});
