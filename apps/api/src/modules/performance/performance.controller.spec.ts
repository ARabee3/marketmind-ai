import { GUARDS_METADATA } from "@nestjs/common/constants";
import { PerformanceController } from "./performance.controller";
import { PerformanceService } from "./performance.service";
import { PERMISSIONS_KEY } from "../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../rbac/rbac.constants";

describe("PerformanceController", () => {
  const service = {
    getOverview: jest.fn().mockResolvedValue({ overview: true }),
    listPosts: jest.fn().mockResolvedValue({ posts: [] }),
    listSnapshots: jest.fn().mockResolvedValue([]),
    refresh: jest.fn().mockResolvedValue({ status: "queued", windows: [] }),
  } as unknown as jest.Mocked<PerformanceService>;
  const controller = new PerformanceController(service);
  const request = { user: { id: "owner-1" } } as never;
  const resultId = "a1000000-0000-4000-8000-000000000003";

  beforeEach(() => jest.clearAllMocks());

  it("keeps all routes owner-scoped through the authenticated user", async () => {
    await controller.overview(request);
    await controller.posts(request, "cursor-1", "text_post");
    await controller.snapshots(request, resultId);
    await controller.refresh(request, resultId);

    expect(service.getOverview).toHaveBeenCalledWith("owner-1");
    expect(service.listPosts).toHaveBeenCalledWith("owner-1", {
      cursor: "cursor-1",
      format: "text_post",
    });
    expect(service.listSnapshots).toHaveBeenCalledWith("owner-1", resultId);
    expect(service.refresh).toHaveBeenCalledWith("owner-1", resultId);
  });

  it("declares JWT and permission guards for the owner API", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PerformanceController),
    ).toHaveLength(2);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PerformanceController)).toEqual(
      [PERMISSIONS.BUSINESS_READ],
    );
  });
});
