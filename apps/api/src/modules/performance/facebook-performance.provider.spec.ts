import { ConfigService } from "@nestjs/config";
import {
  FacebookGraphError,
  FacebookService,
} from "../facebook/facebook.service";
import { CredentialVaultService } from "../publishing/credentials/credential-vault.service";
import {
  MetaGraphClient,
  MetaGraphClientError,
} from "../publishing/meta/meta-graph.client";
import {
  FacebookPerformanceProvider,
  PerformanceProviderError,
} from "./facebook-performance.provider";

const context = {
  publishingResultId: "result-1",
  businessId: "business-1",
  ownerUserId: "owner-1",
  publishingAttemptId: "attempt-1",
  publicationIntentId: "intent-1",
  candidateId: "candidate-1",
  candidateChecksum: "checksum",
  providerObjectId: "page-1_post-1",
  publishedAt: new Date("2026-08-18T08:00:00Z"),
  target: {
    externalAccountId: "page-1",
    credentialRef: "credential-1",
    connectionState: "CONNECTED",
    expiresAt: null,
  },
};

function makeProvider(overrides: Record<string, unknown> = {}) {
  const prisma = {
    publishingCredential: { findFirst: jest.fn() },
    socialConnection: { findUnique: jest.fn() },
    ...overrides,
  };
  const graph = {
    fetchFacebookPostInsights: jest.fn().mockResolvedValue({
      postId: "page-1_post-1",
      metrics: [],
    }),
  };
  const vault = { decrypt: jest.fn().mockReturnValue("page-token") };
  const facebook = { withPageTokenForUser: jest.fn() };
  const config = {
    get: jest.fn((_key: string, fallback?: string) => fallback),
  };
  const provider = new FacebookPerformanceProvider(
    prisma as never,
    graph as unknown as MetaGraphClient,
    vault as unknown as CredentialVaultService,
    facebook as unknown as FacebookService,
    config as unknown as ConfigService,
  );
  return { provider, prisma, graph, vault, facebook };
}

describe("FacebookPerformanceProvider", () => {
  it("resolves the legacy encrypted Page credential server-side", async () => {
    const { provider, prisma, graph, vault } = makeProvider();
    prisma.publishingCredential.findFirst.mockResolvedValue({
      ciphertext: "ciphertext",
      keyVersion: "v1",
      providerAccountId: "page-1",
      expiresAt: null,
    });

    await provider.fetch(context);

    expect(vault.decrypt).toHaveBeenCalledWith({
      ciphertext: "ciphertext",
      keyVersion: "v1",
      providerAccountId: "page-1",
      expiresAt: null,
    });
    expect(graph.fetchFacebookPostInsights).toHaveBeenCalledWith({
      pageToken: "page-token",
      postId: "page-1_post-1",
      metrics: [
        "post_media_view",
        "post_total_media_view_unique",
        "post_clicks",
      ],
    });
  });

  it("uses the SocialConnection credential boundary without putting a token in job data", async () => {
    const { provider, prisma, facebook, graph } = makeProvider();
    const socialContext = {
      ...context,
      target: {
        ...context.target,
        credentialRef: "facebook-social-connection:connection-1",
      },
    };
    prisma.socialConnection.findUnique.mockResolvedValue({
      id: "connection-1",
    });
    facebook.withPageTokenForUser.mockImplementation(
      async (_input: unknown, operation: (token: string) => Promise<unknown>) =>
        operation("opaque-page-token"),
    );

    await provider.fetch(socialContext);

    expect(facebook.withPageTokenForUser).toHaveBeenCalledWith(
      { userId: "owner-1", pageId: "page-1" },
      expect.any(Function),
    );
    expect(graph.fetchFacebookPostInsights).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: "opaque-page-token" }),
    );
    expect(
      JSON.stringify(facebook.withPageTokenForUser.mock.calls[0][0]),
    ).not.toContain("opaque-page-token");
  });

  it("maps permission, rate-limit, and deleted-post failures to stable sanitized states", async () => {
    const cases = [
      [
        new MetaGraphClientError({
          status: 403,
          code: 200,
          message: "secret token",
        }),
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
      ],
      [
        new MetaGraphClientError({
          status: 429,
          code: 4,
          message: "secret token",
        }),
        "PERFORMANCE_PROVIDER_RATE_LIMITED",
        true,
      ],
      [
        new MetaGraphClientError({
          status: 404,
          code: 100,
          message: "secret token",
        }),
        "PERFORMANCE_PROVIDER_UNAVAILABLE",
        false,
      ],
      [
        new FacebookGraphError(401, 190, "expired"),
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
      ],
    ] as const;
    for (const [error, code, retryable] of cases) {
      const { provider, prisma } = makeProvider();
      prisma.publishingCredential.findFirst.mockResolvedValue({
        ciphertext: "ciphertext",
        keyVersion: "v1",
        providerAccountId: "page-1",
        expiresAt: null,
      });
      const graph = (
        provider as unknown as {
          graph: { fetchFacebookPostInsights: jest.Mock };
        }
      ).graph;
      graph.fetchFacebookPostInsights.mockRejectedValue(error);
      await expect(provider.fetch(context)).rejects.toMatchObject<
        Partial<PerformanceProviderError>
      >({
        code,
        retryable,
      });
    }
  });

  it("blocks an expired publishing target before making a Graph request", async () => {
    const { provider, graph } = makeProvider();

    await expect(
      provider.fetch({
        ...context,
        target: {
          ...context.target,
          expiresAt: new Date("2026-08-17T00:00:00Z"),
        },
      }),
    ).rejects.toMatchObject({
      code: "PERFORMANCE_PERMISSION_REQUIRED",
      retryable: false,
    });
    expect(graph.fetchFacebookPostInsights).not.toHaveBeenCalled();
  });
});
