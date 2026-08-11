import { Role } from "@prisma/client";

import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
} from "./rbac.constants";

describe("rbac.constants", () => {
  it("defines CONTENT_START as content:start", () => {
    expect(PERMISSIONS.CONTENT_START).toBe("content:start");
  });

  it("grants CONTENT_START to the owner role", () => {
    expect(ROLE_PERMISSIONS[Role.OWNER]).toContain(PERMISSIONS.CONTENT_START);
  });

  it("does NOT grant CONTENT_START to developer_demo", () => {
    expect(ROLE_PERMISSIONS[Role.DEVELOPER_DEMO]).not.toContain(
      PERMISSIONS.CONTENT_START,
    );
  });

  it("does NOT grant ADMIN_MANAGE_LIBRARY to the owner role", () => {
    expect(ROLE_PERMISSIONS[Role.OWNER]).not.toContain(
      PERMISSIONS.ADMIN_MANAGE_LIBRARY,
    );
  });

  it("includes CONTENT_START in ALL_PERMISSIONS for seeding", () => {
    expect(ALL_PERMISSIONS).toContain(PERMISSIONS.CONTENT_START);
  });

  it("defines ADMIN_PLATFORM as admin:platform", () => {
    expect(PERMISSIONS.ADMIN_PLATFORM).toBe("admin:platform");
  });

  it("does NOT grant ADMIN_PLATFORM to the owner role", () => {
    expect(ROLE_PERMISSIONS[Role.OWNER]).not.toContain(
      PERMISSIONS.ADMIN_PLATFORM,
    );
  });

  it("grants ADMIN_PLATFORM to the admin role", () => {
    expect(ROLE_PERMISSIONS[Role.ADMIN]).toContain(
      PERMISSIONS.ADMIN_PLATFORM,
    );
  });
});
