import { ConfigService } from "@nestjs/config";
import type { Response } from "express";

import { FacebookService } from "../facebook.service";
import { FacebookController } from "../facebook.controller";

function createController(overrides: {
  service?: Partial<FacebookService>;
} = {}): FacebookController {
  const service = {
    buildAuthorizationUrl: jest.fn(),
    handleCallback: jest.fn(),
    getConnection: jest.fn(),
    testConnection: jest.fn(),
    disconnect: jest.fn(),
    ...overrides.service,
  } as unknown as FacebookService;
  const config = {
    get: jest.fn((path: string) =>
      path === "cors.origin" ? "http://localhost:3000" : undefined,
    ),
  } as unknown as ConfigService;
  return new FacebookController(service, config);
}

function mockResponse(): Response {
  return {
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn(),
  } as unknown as Response;
}

describe("FacebookController", () => {
  describe("GET /auth/facebook/start", () => {
    it("redirects the popup to the Facebook dialog", () => {
      const service = {
        buildAuthorizationUrl: jest.fn().mockReturnValue("https://www.facebook.com/v20.0/dialog/oauth?state=abc"),
      };
      const controller = createController({ service });
      const res = mockResponse();
      const req = { user: { id: "user-1" } };

      controller.start(req as never, res);

      expect(service.buildAuthorizationUrl).toHaveBeenCalledWith("user-1");
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        "https://www.facebook.com/v20.0/dialog/oauth?state=abc",
      );
    });

    it("posts an error back to the opener when the app is not configured", () => {
      const service = {
        buildAuthorizationUrl: jest.fn().mockImplementation(() => {
          throw new Error("Facebook app configuration is missing");
        }),
      };
      const controller = createController({ service });
      const res = mockResponse();

      controller.start({ user: { id: "user-1" } } as never, res);

      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining("fb-connect-error"),
      );
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:3000"),
      );
    });
  });

  describe("GET /auth/facebook/callback", () => {
    it("renders an error page when code or state is missing", async () => {
      const controller = createController();
      const res = mockResponse();

      await controller.callback(undefined, undefined, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining("fb-connect-error"),
      );
    });

    it("renders a connected page with the page name on success", async () => {
      const service = {
        handleCallback: jest.fn().mockResolvedValue({
          ok: true,
          pageName: "Koshary Corner",
        }),
      };
      const controller = createController({ service });
      const res = mockResponse();

      await controller.callback("auth-code", "state-1", res);

      expect(res.status).toHaveBeenCalledWith(200);
      const html = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(html).toContain("fb-connected");
      expect(html).toContain("Koshary Corner");
      expect(html).toContain("http://localhost:3000");
    });

    it("renders an error page when the exchange fails", async () => {
      const service = {
        handleCallback: jest.fn().mockResolvedValue({
          ok: false,
          error: "The connection request expired. Please try again.",
        }),
      };
      const controller = createController({ service });
      const res = mockResponse();

      await controller.callback("auth-code", "expired-state", res);

      expect(res.status).toHaveBeenCalledWith(200);
      const html = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(html).toContain("fb-connect-error");
      expect(html).toContain("expired");
    });
  });

  describe("GET /connections", () => {
    it("returns the user's connection view", async () => {
      const connection = {
        provider: "facebook",
        pageName: "Koshary Corner",
        isValid: true,
        connectedAt: new Date(),
        lastTestedAt: null,
      };
      const service = {
        getConnection: jest.fn().mockResolvedValue(connection),
      };
      const controller = createController({ service });

      const result = await controller.getConnection({
        user: { id: "user-1" },
      } as never);

      expect(service.getConnection).toHaveBeenCalledWith("user-1");
      expect(result).toBe(connection);
    });
  });

  describe("POST /connections/facebook/test", () => {
    it("delegates to testConnection", async () => {
      const service = {
        testConnection: jest
          .fn()
          .mockResolvedValue({ success: true, postId: "post-1" }),
      };
      const controller = createController({ service });

      const result = await controller.testConnection({
        user: { id: "user-1" },
      } as never);

      expect(service.testConnection).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ success: true, postId: "post-1" });
    });
  });

  describe("DELETE /connections/facebook", () => {
    it("delegates to disconnect", async () => {
      const service = { disconnect: jest.fn().mockResolvedValue(undefined) };
      const controller = createController({ service });

      await controller.disconnect({ user: { id: "user-1" } } as never);

      expect(service.disconnect).toHaveBeenCalledWith("user-1");
    });
  });
});
