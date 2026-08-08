import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import {
  META_LEAST_PRIVILEGE_SCOPES,
  MetaGraphClient,
  MetaGraphClientError,
} from "../meta-graph.client";
import { mapMetaGraphError } from "../meta-error.mapper";

const mockFacebookService = {
  publishPhotoViaPageToken: jest.fn(),
} as const;

function makeClient(
  mockGet: (path: string, options: unknown) => unknown = () => of({ data: {} }),
  mockPost: (path: string, body: unknown, options: unknown) => unknown = () =>
    of({ data: {} }),
  facebookOverride?: Partial<typeof mockFacebookService>,
) {
  const http = {
    get: jest.fn(mockGet),
    post: jest.fn(mockPost),
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      const map: Record<string, string> = {
        "meta.appId": "app-id-1",
        "meta.appSecret": "app-secret-1",
        "meta.redirectUri": "https://app.example/api/v1/publishing-targets/meta/callback",
        "meta.graphBaseUrl": "https://graph.facebook.com",
        "meta.graphVersion": "v21.0",
        "meta.requestTimeoutMs": "15000",
      };
      return map[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  const facebook = {
    publishPhotoViaPageToken: mockFacebookService.publishPhotoViaPageToken,
    ...facebookOverride,
  };
  return { client: new MetaGraphClient(http as never, config, facebook as never), http };
}

beforeEach(() => {
  mockFacebookService.publishPhotoViaPageToken.mockReset();
});

describe("MetaGraphClient (issue #175)", () => {
  it("builds an authorization URL carrying state + least-privilege scopes — no token", () => {
    const { client } = makeClient();
    const url = client.buildAuthorizationUrl("state-abc");

    expect(url).toContain("/v21.0/dialog/oauth");
    expect(url).toContain("client_id=app-id-1");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("state=state-abc");
    expect(url).toContain("response_type=code");
    for (const scope of META_LEAST_PRIVILEGE_SCOPES) {
      expect(url).toContain(scope);
    }
    expect(url).not.toContain("access_token");
    expect(url).not.toContain("client_secret");
  });

  it("exchanges a code for a long-lived user token server-to-server", async () => {
    const { client, http } = makeClient(
      (path) => {
        if (path === "/oauth/access_token") return of({ data: { access_token: "short-lived" } });
        if (path === "/me") return of({ data: { id: "fb-user-1", name: "Owner" } });
        throw new Error(`unexpected GET ${path}`);
      },
      () => of({ data: {} }),
    );
    http.get.mockImplementationOnce(() =>
      of({ data: { access_token: "short-lived", expires_in: 5184000 } }),
    );
    http.get.mockImplementationOnce(() =>
      of({ data: { access_token: "long-lived-token", expires_in: 5184000 } }),
    );
    http.get.mockImplementationOnce(() =>
      of({ data: { id: "fb-user-1", name: "Owner" } }),
    );

    const token = await client.exchangeCodeForLongLivedUserToken("code-1");

    expect(token.accessToken).toBe("long-lived-token");
    expect(token.userId).toBe("fb-user-1");
    // The client_secret is a server-side deployment secret: it must travel to
    // Meta but never back into any response.
    const firstCall = http.get.mock.calls[0];
    expect(firstCall[0]).toBe("https://graph.facebook.com/v21.0/oauth/access_token");
    expect((firstCall[1] as any).params).toMatchObject({
      client_id: "app-id-1",
      client_secret: "app-secret-1",
      code: "code-1",
    });
    const secondCall = http.get.mock.calls[1];
    expect((secondCall[1] as any).params).toMatchObject({
      grant_type: "fb_exchange_token",
      fb_exchange_token: "short-lived",
    });
  });

  it("normalizes provider errors into sanitized MetaGraphClientError", async () => {
    const { client, http } = makeClient();
    (http.get as jest.Mock).mockImplementationOnce(() =>
      throwError(
        Object.assign(new Error("boom"), {
          response: {
            status: 429,
            data: { error: { code: 4, message: "rate limited" } },
          },
        }),
      ),
    );
    await expect(client.listManageablePages("token")).rejects.toMatchObject({
      info: { status: 429, code: 4 },
    });
  });

  it("maps discovery pages + linked Instagram business accounts safely", async () => {
    const { client, http } = makeClient();
    http.get.mockImplementation(() =>
      of({
        data: {
          data: [
            {
              id: "page-1",
              name: "Café Page",
              access_token: "page-token-1",
              instagram_business_account: {
                id: "ig-1",
                username: "cafe.eg",
                name: "Café IG",
              },
            },
            { id: "page-2", name: "No IG Page", access_token: null },
          ],
        },
      }),
    );
    const pages = await client.listManageablePages("user-token");
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({
      pageId: "page-1",
      name: "Café Page",
      accessToken: "page-token-1",
      instagramBusinessAccount: { id: "ig-1", username: "cafe.eg", name: "Café IG" },
    });
    expect(pages[1].accessToken).toBeNull();
    expect(pages[1].instagramBusinessAccount).toBeNull();
  });

  it("publishes a Facebook photo by delegating to FacebookService", async () => {
    const { client } = makeClient();
    mockFacebookService.publishPhotoViaPageToken.mockResolvedValue({
      remotePublicationId: "post-1",
      remoteUrl: "https://facebook.example/post-1",
    });

    const result = await client.publishFacebookPhoto({
      pageToken: "page-token",
      pageId: "page-1",
      imageUrl: "http://localhost:3001/internal/v1/publishing/media-fetch/a?token=x",
      caption: "caption",
    });

    expect(result).toEqual({
      remotePublicationId: "post-1",
      remoteUrl: "https://facebook.example/post-1",
    });
    expect(mockFacebookService.publishPhotoViaPageToken).toHaveBeenCalledWith({
      pageToken: "page-token",
      pageId: "page-1",
      imageUrl: expect.stringContaining("media-fetch"),
      caption: "caption",
    });
  });

  it("normalises FacebookService errors into MetaGraphClientError", async () => {
    const { client } = makeClient();
    const axiosError = Object.assign(new Error("boom"), {
      isAxiosError: true,
      response: {
        status: 429,
        data: { error: { code: 4, message: "rate limited" } },
      },
    });
    mockFacebookService.publishPhotoViaPageToken.mockRejectedValue(axiosError);

    await expect(
      client.publishFacebookPhoto({
        pageToken: "page-token",
        pageId: "page-1",
        imageUrl: "http://x",
        caption: "c",
      }),
    ).rejects.toMatchObject({
      info: { status: 429, code: 4 },
    });
  });

  it("publishes an Instagram photo: container → poll → media_publish", async () => {
    const { client, http } = makeClient();
    http.post.mockImplementation((path: string) =>
      of({
        data: path.includes("/media") && !path.includes("media_publish")
          ? { id: "container-1" }
          : { id: "media-1" },
      }),
    );
    http.get.mockImplementation(() =>
      of({ data: { status_code: "FINISHED" } }),
    );

    const result = await client.publishInstagramPhoto({
      pageToken: "page-token",
      igBusinessId: "ig-1",
      imageUrl: "http://localhost:3001/internal/v1/publishing/media-fetch/a?token=x",
      caption: "caption",
    });

    expect(result.remotePublicationId).toBe("media-1");
    const postPaths = http.post.mock.calls.map((c) => c[0]);
    expect(postPaths[0]).toBe("https://graph.facebook.com/v21.0/ig-1/media");
    expect(postPaths[1]).toBe("https://graph.facebook.com/v21.0/ig-1/media_publish");
    expect((http.post.mock.calls[1][2] as any).params).toMatchObject({
      creation_id: "container-1",
    });
  });

  it("does not publish an Instagram container stuck in IN_PROGRESS", async () => {
    const { client, http } = makeClient();
    (http.get as jest.Mock).mockImplementation(() =>
      of({ data: { status_code: "IN_PROGRESS" } }),
    );
    (http.post as jest.Mock).mockImplementation(() =>
      of({ data: { id: "container-1" } }),
    );
    (client as unknown as { config: (k: string, f: string) => string }).config = (
      k: string,
      f: string,
    ) => (k === "meta.igPollIntervalMs" ? "1" : k === "meta.igPollAttempts" ? "2" : f);

    await expect(
      client.publishInstagramPhoto({
        pageToken: "page-token",
        igBusinessId: "ig-1",
        imageUrl: "http://x",
        caption: "c",
      }),
    ).rejects.toThrow(MetaGraphClientError);
    expect(http.post).toHaveBeenCalledTimes(1); // media_publish never called
  });

  it("fails closed when Meta app configuration is missing", async () => {
    const { client } = makeClient();
    (client as unknown as { appId: string }).appId = "";
    (client as unknown as { appSecret: string }).appSecret = "";
    await expect(
      client.exchangeCodeForLongLivedUserToken("code"),
    ).rejects.toMatchObject({
      info: { message: expect.stringContaining("PUBLISHING_META_NOT_CONFIGURED") },
    });
  });
});

describe("mapMetaGraphError", () => {
  const err = (status: number, code: number) =>
    new MetaGraphClientError({ status, code, message: "x" });

  it("maps auth failures to TARGET_UNAUTHORIZED (not retryable)", () => {
    expect(mapMetaGraphError(err(401, 190)).errorCode).toBe(
      "PUBLISHING_TARGET_UNAUTHORIZED",
    );
    expect(mapMetaGraphError(err(200, 190)).retryable).toBe(false);
  });

  it("maps rate limits to PROVIDER_RATE_LIMITED (retryable)", () => {
    const mapped = mapMetaGraphError(err(429, 4));
    expect(mapped).toEqual({
      errorCode: "PUBLISHING_PROVIDER_RATE_LIMITED",
      retryable: true,
    });
  });

  it("maps server failures as retryable PROVIDER_FAILURE, client errors as not", () => {
    expect(mapMetaGraphError(err(503, 1))).toEqual({
      errorCode: "PUBLISHING_PROVIDER_FAILURE",
      retryable: true,
    });
    expect(mapMetaGraphError(err(400, 1)).retryable).toBe(false);
  });
});
