import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

import { PrismaService } from "../../../common/persistence/prisma.service";
import { MailService } from "../../mail/mail.service";
import { EncryptionService } from "../encryption.service";
import { FacebookOAuthStateStore } from "../facebook-oauth-state.store";
import {
  FACEBOOK_INVALID_TOKEN_CODE,
  FacebookService,
} from "../facebook.service";

const TEST_KEY =
  "c3b2e6a9d1f47850a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192";

const CONFIG_MAP: Record<string, string> = {
  "facebook.appId": "4446203915630413",
  "facebook.appSecret": "app-secret",
  "facebook.redirectUri": "http://localhost:3001/api/v1/auth/facebook/callback",
  "facebook.graphVersion": "v20.0",
  "facebook.tokenEncryptionKey": TEST_KEY,
};

function createService(
  overrides: {
    prisma?: Record<string, unknown>;
    mailer?: Partial<MailService>;
  } = {},
): FacebookService {
  const configService = {
    get: jest.fn((path: string) => CONFIG_MAP[path]),
  } as unknown as ConfigService;
  const encryption = new EncryptionService(configService);
  const prisma = {
    socialConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    },
    ...overrides.prisma,
  } as unknown as PrismaService;
  const mailer = {
    sendFacebookExpiredEmail: jest.fn(),
    ...overrides.mailer,
  } as unknown as MailService;
  return new FacebookService(
    prisma,
    configService,
    encryption,
    mailer,
    createStateStore(),
  );
}

function createStateStore(): FacebookOAuthStateStore {
  const starts = new Map<string, string>();
  const states = new Map<string, string>();
  let sequence = 0;
  const create = (store: Map<string, string>, userId: string) => {
    const token = `facebook-test-token-${++sequence}`;
    store.set(token, userId);
    return Promise.resolve(token);
  };
  const consume = (store: Map<string, string>, token: string | undefined) =>
    Promise.resolve(token ? (store.get(token) ?? null) : null).then(
      (userId) => {
        if (token) store.delete(token);
        return userId;
      },
    );
  return {
    createStartSession: (userId) => create(starts, userId),
    consumeStartSession: (token) => consume(starts, token),
    createOAuthState: (userId) => create(states, userId),
    consumeOAuthState: (token) => consume(states, token),
  } as unknown as FacebookOAuthStateStore;
}

function stateFromUrl(url: string): string {
  return new URL(url).searchParams.get("state") as string;
}

describe("FacebookService", () => {
  let axiosGetSpy: jest.SpyInstance;
  let axiosPostSpy: jest.SpyInstance;

  beforeEach(() => {
    axiosGetSpy = jest.spyOn(axios, "get");
    axiosPostSpy = jest.spyOn(axios, "post");
  });

  afterEach(() => {
    axiosGetSpy.mockRestore();
    axiosPostSpy.mockRestore();
  });

  describe("start sessions (popup identity without Bearer header)", () => {
    it("creates a one-time token and consumes it back to the user", async () => {
      const service = createService();
      const token = await service.createStartSession("user-1");

      expect(token).toBeTruthy();
      await expect(service.consumeStartSession(token)).resolves.toBe("user-1");
    });

    it("is single-use: a consumed token cannot be replayed", async () => {
      const service = createService();
      const token = await service.createStartSession("user-1");

      await expect(service.consumeStartSession(token)).resolves.toBe("user-1");
      await expect(service.consumeStartSession(token)).resolves.toBeNull();
    });

    it("rejects an unknown or empty token", async () => {
      const service = createService();

      await expect(service.consumeStartSession("bogus")).resolves.toBeNull();
      await expect(service.consumeStartSession(undefined)).resolves.toBeNull();
    });
  });

  describe("buildAuthorizationUrl", () => {
    it("builds the Facebook dialog URL with required scopes and a state", async () => {
      const service = createService();
      const url = await service.buildAuthorizationUrl("user-1");

      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://www.facebook.com");
      expect(parsed.pathname).toBe("/v20.0/dialog/oauth");
      expect(parsed.searchParams.get("client_id")).toBe("4446203915630413");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3001/api/v1/auth/facebook/callback",
      );
      expect(parsed.searchParams.get("scope")).toBe(
        "pages_show_list,pages_read_engagement,pages_manage_posts",
      );
      expect(parsed.searchParams.get("state")).toBeTruthy();
    });

    it("throws when the app is not configured", async () => {
      const service = createService();
      const config = {
        get: jest.fn((path: string) => {
          if (path === "facebook.tokenEncryptionKey") return TEST_KEY;
          return "";
        }),
      } as unknown as ConfigService;
      const bare = new FacebookService(
        {} as PrismaService,
        config,
        new EncryptionService(config),
        {} as MailService,
        createStateStore(),
      );

      await expect(bare.buildAuthorizationUrl("user-1")).rejects.toThrow(
        "Facebook app configuration is missing",
      );
    });
  });

  describe("handleCallback", () => {
    it("rejects an invalid or unknown state", async () => {
      const service = createService();

      const result = await service.handleCallback("code", "bogus-state");

      expect(result).toEqual({
        ok: false,
        error: "The connection request expired. Please try again.",
      });
    });

    it("exchanges the code, stores the first page, and upserts the connection", async () => {
      const service = createService({
        prisma: {
          socialConnection: {
            findUnique: jest.fn(),
            upsert: jest.fn().mockResolvedValue({ id: "conn-1" }),
            update: jest.fn(),
            deleteMany: jest.fn(),
          },
        },
      });
      const url = await service.buildAuthorizationUrl("user-1");
      const state = stateFromUrl(url);

      axiosGetSpy
        .mockResolvedValueOnce({ data: { access_token: "short-token" } })
        .mockResolvedValueOnce({ data: { access_token: "long-token" } })
        .mockResolvedValueOnce({
          data: {
            data: [
              {
                id: "page-42",
                name: "Koshary Corner",
                access_token: "EAA-page-token",
              },
              {
                id: "page-43",
                name: "Other Page",
                access_token: "EAA-other-token",
              },
            ],
          },
        });

      const upsert = (
        service as unknown as {
          prisma: { socialConnection: { upsert: jest.Mock } };
        }
      ).prisma.socialConnection.upsert;

      const result = await service.handleCallback("auth-code", state);

      expect(axiosGetSpy).toHaveBeenCalledTimes(3);
      const [exchangeUrl] = axiosGetSpy.mock.calls[0] as [string, unknown];
      expect(exchangeUrl).toContain("/v20.0/oauth/access_token");
      const [, longLivedOptions] = axiosGetSpy.mock.calls[1] as [
        string,
        { params: { grant_type: string; fb_exchange_token: string } },
      ];
      expect(longLivedOptions.params.grant_type).toBe("fb_exchange_token");
      expect(longLivedOptions.params.fb_exchange_token).toBe("short-token");
      const [accountsUrl, accountsParams] = axiosGetSpy.mock.calls[2] as [
        string,
        { params: { access_token: string } },
      ];
      expect(accountsUrl).toContain("/v20.0/me/accounts");
      expect(accountsParams.params.access_token).toBe("long-token");

      expect(result).toEqual({ ok: true, pageName: "Koshary Corner" });
      expect(upsert).toHaveBeenCalledTimes(1);
      const upsertArgs = upsert.mock.calls[0] as [
        {
          where: { userId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        },
      ];
      expect(upsertArgs[0].where.userId).toBe("user-1");
      const create = upsertArgs[0].create;
      expect(create.pageId).toBe("page-42");
      expect(create.pageName).toBe("Koshary Corner");
      expect(create.encryptedToken).not.toContain("EAA-page-token");
      expect(create.isValid).toBe(true);
      expect(upsertArgs[0].update.isValid).toBe(true);
    });

    it("returns an error when no page is available", async () => {
      const service = createService();
      const url = await service.buildAuthorizationUrl("user-1");
      const state = stateFromUrl(url);

      axiosGetSpy
        .mockResolvedValueOnce({ data: { access_token: "short-token" } })
        .mockResolvedValueOnce({ data: { access_token: "long-token" } })
        .mockResolvedValueOnce({ data: { data: [] } });

      const result = await service.handleCallback("auth-code", state);

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toContain("could not connect");
      }
    });
  });

  describe("getConnection", () => {
    it("returns the public connection view", async () => {
      const prisma = {
        socialConnection: {
          findUnique: jest.fn().mockResolvedValue({
            provider: "facebook",
            pageName: "Koshary Corner",
            isValid: true,
            connectedAt: new Date("2026-08-01T12:00:00Z"),
            lastTestedAt: new Date("2026-08-05T09:00:00Z"),
          }),
          upsert: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          deleteMany: jest.fn(),
        },
      };
      const service = createService({ prisma });
      const connection = await service.getConnection("user-1");

      expect(connection).toEqual({
        provider: "facebook",
        pageName: "Koshary Corner",
        isValid: true,
        connectedAt: new Date("2026-08-01T12:00:00Z"),
        lastTestedAt: new Date("2026-08-05T09:00:00Z"),
      });
    });

    it("returns null when the user has no connection", async () => {
      const prisma = {
        socialConnection: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          deleteMany: jest.fn(),
        },
      };
      const service = createService({ prisma });

      expect(await service.getConnection("user-1")).toBeNull();
    });
  });

  describe("publishPost", () => {
    const connectionRow = {
      userId: "user-1",
      pageId: "page-42",
      encryptedToken: "",
      encryptionIv: "",
      authTag: "",
      isValid: true,
      connectedAt: new Date(),
      lastTestedAt: null,
    };

    function serviceWithStoredToken(token: string): FacebookService {
      const encryption = new EncryptionService({
        get: (path: string) => CONFIG_MAP[path],
      } as unknown as ConfigService);
      const encrypted = encryption.encrypt(token);
      const prisma = {
        socialConnection: {
          findUnique: jest.fn().mockResolvedValue({
            ...connectionRow,
            encryptedToken: encrypted.ciphertext,
            encryptionIv: encrypted.iv,
            authTag: encrypted.authTag,
          }),
          upsert: jest.fn(),
          update: jest.fn().mockResolvedValue(connectionRow),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          deleteMany: jest.fn(),
        },
      } as unknown as PrismaService;
      const mailer = {
        sendFacebookExpiredEmail: jest.fn(),
      } as unknown as MailService;
      return new FacebookService(
        prisma,
        {
          get: (path: string) => CONFIG_MAP[path],
        } as unknown as ConfigService,
        encryption,
        mailer,
        createStateStore(),
      );
    }

    it("posts to the page feed and records lastTestedAt", async () => {
      const service = serviceWithStoredToken("EAA-secret-token");
      axiosPostSpy.mockResolvedValue({ data: { id: "post-1" } });

      const result = await service.publishPost("user-1", "hello");

      expect(result).toEqual({ success: true, postId: "post-1" });
      expect(axiosPostSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v20.0/page-42/feed"),
        { message: "hello", access_token: "EAA-secret-token" },
      );
      const update = (
        service as unknown as {
          prisma: { socialConnection: { update: jest.Mock } };
        }
      ).prisma.socialConnection.update;
      expect(update).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        data: { lastTestedAt: expect.any(Date) },
      });
    });

    it("invalidates the connection and emails the owner on error code 190", async () => {
      const service = serviceWithStoredToken("EAA-expired-token");
      axiosPostSpy.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: {
              code: FACEBOOK_INVALID_TOKEN_CODE,
              message: "Error validating access token",
            },
          },
        },
      });

      const result = await service.publishPost("user-1", "hello");

      expect(result).toEqual({ success: false, reason: "expired" });
      const update = (
        service as unknown as {
          prisma: { socialConnection: { update: jest.Mock } };
        }
      ).prisma.socialConnection.update;
      expect(update).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        data: { isValid: false },
      });
      const mailer = (
        service as unknown as {
          mailer: { sendFacebookExpiredEmail: jest.Mock };
        }
      ).mailer;
      expect(mailer.sendFacebookExpiredEmail).toHaveBeenCalledWith("user-1");
    });

    it("returns a generic error for other Graph failures", async () => {
      const service = serviceWithStoredToken("EAA-token");
      axiosPostSpy.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 500,
          data: { error: { code: 1, message: "An unknown error occurred" } },
        },
      });

      const result = await service.publishPost("user-1", "hello");

      expect(result).toEqual({
        success: false,
        reason: "error",
        message: expect.stringContaining("An unknown error occurred"),
      });
    });

    it("throws when the user has no connection", async () => {
      const prisma = {
        socialConnection: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn(),
          update: jest.fn(),
          deleteMany: jest.fn(),
        },
      };
      const service = createService({ prisma });

      await expect(service.publishPost("user-1", "hello")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("testConnection", () => {
    it("reuses the shared publishPost logic with the test message", async () => {
      const service = createService();
      const publishPost = jest
        .spyOn(service, "publishPost")
        .mockResolvedValue({ success: true, postId: "post-9" });

      const result = await service.testConnection("user-1");

      expect(result).toEqual({ success: true, postId: "post-9" });
      expect(publishPost).toHaveBeenCalledWith(
        "user-1",
        "✅ MarketMind AI test post — connection verified.",
      );
    });
  });

  describe("disconnect", () => {
    it("deletes the user's connection row", async () => {
      const prisma = {
        socialConnection: {
          findUnique: jest.fn(),
          upsert: jest.fn(),
          update: jest.fn(),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const service = createService({ prisma });

      await service.disconnect("user-1");

      const deleteMany = (
        service as unknown as {
          prisma: { socialConnection: { deleteMany: jest.Mock } };
        }
      ).prisma.socialConnection.deleteMany;
      expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    });
  });

  describe("publishPhotoViaPageToken", () => {
    it("posts a photo to the page and resolves the permalink", async () => {
      const service = createService();
      axiosPostSpy.mockResolvedValue({
        data: { id: "photo-1", post_id: "post-1" },
      });
      const linkSpy = jest.spyOn(axios, "get").mockResolvedValueOnce({
        data: { link: "https://facebook.example/post-1" },
      });

      const result = await service.publishPhotoViaPageToken({
        pageToken: "page-token",
        pageId: "page-42",
        imageUrl: "https://cdn.example/img.jpg",
        caption: "test caption",
      });

      expect(result).toEqual({
        remotePublicationId: "post-1",
        remoteUrl: "https://facebook.example/post-1",
      });
      expect(axiosPostSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v20.0/page-42/photos"),
        null,
        expect.objectContaining({
          params: expect.objectContaining({
            url: "https://cdn.example/img.jpg",
            caption: "test caption",
            published: "true",
            access_token: "page-token",
          }),
        }),
      );
      linkSpy.mockRestore();
    });

    it("returns remoteUrl null when the permalink lookup fails", async () => {
      const service = createService();
      axiosPostSpy.mockResolvedValue({
        data: { post_id: "post-2" },
      });
      const linkSpy = jest
        .spyOn(axios, "get")
        .mockRejectedValueOnce(new Error("down"));

      const result = await service.publishPhotoViaPageToken({
        pageToken: "page-token",
        pageId: "page-42",
        imageUrl: "https://cdn.example/img.jpg",
        caption: "test caption",
      });

      expect(result.remotePublicationId).toBe("post-2");
      expect(result.remoteUrl).toBeNull();
      linkSpy.mockRestore();
    });

    it("throws when the response carries no post id", async () => {
      const service = createService();
      axiosPostSpy.mockResolvedValue({
        data: { id: "" },
      });

      await expect(
        service.publishPhotoViaPageToken({
          pageToken: "page-token",
          pageId: "page-42",
          imageUrl: "https://cdn.example/img.jpg",
          caption: "test caption",
        }),
      ).rejects.toThrow("page photos response carried no post id");
    });

    it("propagates Graph API errors so MetaGraphClient can normalise them", async () => {
      const service = createService();
      const graphError = Object.assign(new Error("Graph error"), {
        isAxiosError: true,
        response: {
          status: 429,
          data: { error: { code: 4, message: "rate limited" } },
        },
      });
      axiosPostSpy.mockRejectedValue(graphError);

      await expect(
        service.publishPhotoViaPageToken({
          pageToken: "page-token",
          pageId: "page-42",
          imageUrl: "https://cdn.example/img.jpg",
          caption: "test caption",
        }),
      ).rejects.toThrow("Graph error");
    });
  });

  describe("provider-facing publish methods", () => {
    it("turns a disconnected owner connection into a deterministic Graph auth error", async () => {
      const service = createService({
        prisma: {
          socialConnection: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            deleteMany: jest.fn(),
          },
        },
      });

      await expect(
        service.publishPhotoForUser({
          userId: "user-1",
          pageId: "page-42",
          imageUrl: "https://cdn.example/asset.png",
          caption: "hello",
        }),
      ).rejects.toMatchObject({
        name: "FacebookGraphError",
        status: 401,
        code: FACEBOOK_INVALID_TOKEN_CODE,
      });
      expect(axiosPostSpy).not.toHaveBeenCalled();
    });
  });
});
