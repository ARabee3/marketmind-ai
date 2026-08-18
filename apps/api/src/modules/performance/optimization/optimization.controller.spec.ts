import { GUARDS_METADATA } from "@nestjs/common/constants";
import { BadRequestException } from "@nestjs/common";
import { PERMISSIONS_KEY } from "../../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../../rbac/rbac.constants";
import { OptimizationController } from "./optimization.controller";
import { OptimizationService } from "./optimization.service";

describe("OptimizationController", () => {
  const service = {
    readiness: jest.fn().mockResolvedValue({ readiness: { status: "ready" } }),
    generate: jest.fn().mockResolvedValue({ outcome: "not_ready" }),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      proposal_id: "a4000000-0000-4000-8000-000000000001",
    }),
  } as unknown as jest.Mocked<OptimizationService>;
  const controller = new OptimizationController(service);
  const request = { user: { id: "owner-1" } } as never;

  beforeEach(() => jest.clearAllMocks());

  it("delegates owner-scoped readiness, generation, and reads", async () => {
    await controller.readiness(request, "text_post");
    await controller.generate(request, { format: "text_post" });
    await controller.list(request);
    await controller.get(request, "a4000000-0000-4000-8000-000000000001");

    expect(service.readiness).toHaveBeenCalledWith("owner-1", "text_post");
    expect(service.generate).toHaveBeenCalledWith("owner-1", {
      format: "text_post",
    });
    expect(service.list).toHaveBeenCalledWith("owner-1");
    expect(service.get).toHaveBeenCalledWith(
      "owner-1",
      "a4000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects a format outside the Facebook optimization allowlist", () => {
    expect(() => controller.readiness(request, "carousel_brief")).toThrow(
      BadRequestException,
    );
  });

  it("keeps the route JWT- and permission-guarded", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, OptimizationController),
    ).toHaveLength(2);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, OptimizationController),
    ).toEqual([PERMISSIONS.BUSINESS_READ]);
  });
});
