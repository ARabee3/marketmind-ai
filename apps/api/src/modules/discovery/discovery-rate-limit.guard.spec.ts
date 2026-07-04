import { ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { DiscoveryRateLimitGuard } from "./discovery-rate-limit.guard";

describe("DiscoveryRateLimitGuard", () => {
  it("allows GET status checks without consuming the POST limit", () => {
    const guard = new DiscoveryRateLimitGuard();

    expect(guard.canActivate(contextFor("GET"))).toBe(true);
  });

  it("rejects excessive discovery POST requests from one owner", () => {
    const guard = new DiscoveryRateLimitGuard();

    for (let count = 0; count < 20; count += 1) {
      expect(guard.canActivate(contextFor("POST"))).toBe(true);
    }

    expect(() => guard.canActivate(contextFor("POST"))).toThrow(HttpException);
    try {
      guard.canActivate(contextFor("POST"));
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});

function contextFor(method: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        ip: "127.0.0.1",
        path: "/api/v1/discovery/start",
        route: { path: "/discovery/start" },
        user: { id: "owner-id" },
      }),
    }),
  } as ExecutionContext;
}
