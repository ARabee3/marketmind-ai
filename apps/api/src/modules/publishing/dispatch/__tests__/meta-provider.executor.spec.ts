import { MetaProviderExecutor } from "../meta-provider.executor";
import { CredentialVaultService } from "../../credentials/credential-vault.service";
import { ConfigService } from "@nestjs/config";
import { MetaGraphClientError } from "../../meta/meta-graph.client";

const VAULT_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

function makeVault(): CredentialVaultService {
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      const map: Record<string, string> = {
        "publishing.vaultKey": VAULT_KEY,
        "publishing.vaultKeyVersion": "v1",
        "publishing.vaultPreviousKeys": "{}",
      };
      return map[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  return new CredentialVaultService(config);
}

function makeGraph(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    publishFacebookText: jest.fn(async () => ({
      remotePublicationId: "post-text-123",
      remoteUrl: null,
    })),
    publishFacebookPhoto: jest.fn(async () => ({
      remotePublicationId: "post-123",
      remoteUrl: "https://facebook.example/post-123",
    })),
    publishInstagramPhoto: jest.fn(async () => ({
      remotePublicationId: "ig-media-1",
      remoteUrl: null,
    })),
    ...overrides,
  } as never;
}

type GraphLike = {
  publishFacebookText: jest.Mock;
  publishFacebookPhoto: jest.Mock;
  publishInstagramPhoto: jest.Mock;
};
type MediaFetchLike = {
  buildUrl: jest.Mock;
  isConfigured: jest.Mock;
  configurationError: jest.Mock;
  verify: jest.Mock;
};
type AssetReaderLike = { readApprovedAsset: jest.Mock };

function makeMediaFetch(): MediaFetchLike {
  return {
    buildUrl: jest.fn(
      () =>
        "https://fetch.example.com/internal/v1/publishing/media-fetch/a?token=x",
    ),
    isConfigured: jest.fn(() => true),
    configurationError: jest.fn(() => null),
    verify: jest.fn(() => true),
  };
}

function makeAssetReader(overrides: Partial<AssetReaderLike> = {}) {
  return {
    readApprovedAsset: jest.fn(async (reference) => ({
      id: reference.asset_id,
      mimeType: reference.mime_type,
      checksum: reference.checksum,
      bytes: Buffer.from("verified-asset"),
    })),
    ...overrides,
  } as never;
}

function makeContext(
  overrides: {
    target?: Record<string, unknown>;
    credentialRow?: Record<string, unknown> | null;
    candidate?: Record<string, unknown> | null;
    graph?: unknown;
    mediaFetch?: unknown;
    assetReader?: unknown;
    facebook?: unknown;
  } = {},
) {
  const target = overrides.target ?? {
    id: "target-1",
    businessId: "biz-1",
    provider: "META",
    channel: "facebook",
    externalAccountId: "page-1",
    connectionState: "CONNECTED",
    credentialRef: "vault-1",
    capabilities: ["static_image"],
    expiresAt: null,
  };
  const credential =
    "credentialRow" in overrides
      ? overrides.credentialRow
      : {
          id: "vault-1",
          businessId: "biz-1",
          provider: "META",
          kind: "page",
          revokedAt: null,
          ciphertext: makeVault().encrypt(
            JSON.stringify({
              type: "page",
              token: "EAA-page-token",
              pageId: "page-1",
            }),
          ).ciphertext,
          keyVersion: "v1",
        };
  const attemptTargetId = overrides.target?.id ?? "target-1";
  const prisma = {
    publishingAttempt: {
      findUnique: jest.fn(async () => ({
        id: "attempt-1",
        intentId: "intent-1",
        intent: {
          id: "intent-1",
          targetId: attemptTargetId,
          version: 3,
          candidateId: "candidate-1",
        },
      })),
    },
    publishingTarget: {
      findUnique: jest.fn(async () => target),
    },
    publishingCredential: {
      findUnique: jest.fn(async () => credential),
    },
    publishingCandidate: {
      findUnique: jest.fn(async () =>
        overrides.candidate === undefined
          ? {
              payload: {
                caption: "Hello",
                hashtags: ["#one", "#two"],
                content_format: "static_image_post",
                assets: [
                  {
                    asset_id: "asset-9",
                    mime_type: "image/png",
                    storage_key: "content/asset-9.png",
                    checksum: "abc",
                  },
                ],
              },
            }
          : overrides.candidate,
      ),
    },
    business: {
      findUnique: jest.fn(async () => ({ ownerUserId: "owner-1" })),
    },
    socialConnection: {
      findUnique: jest.fn(async () => ({
        userId: "owner-1",
        provider: "facebook",
        pageId: "page-1",
        isValid: true,
      })),
    },
  };
  const graph = (overrides.graph ?? makeGraph()) as never;
  const mediaFetch = overrides.mediaFetch ?? makeMediaFetch();
  const assetReader = overrides.assetReader ?? makeAssetReader();
  const facebook =
    overrides.facebook ??
    ({
      publishTextForUser: jest.fn(async () => ({
        remotePublicationId: "social-text-1",
        remoteUrl: "https://facebook.example/social-text-1",
      })),
      publishPhotoForUser: jest.fn(async () => ({
        remotePublicationId: "social-post-1",
        remoteUrl: "https://facebook.example/social-post-1",
      })),
    } as const);
  const executor = new MetaProviderExecutor(
    prisma as never,
    makeVault(),
    graph,
    mediaFetch as never,
    assetReader as never,
    facebook as never,
  );
  return {
    executor,
    prisma,
    graph: graph as unknown as GraphLike,
    mediaFetch: mediaFetch as unknown as MediaFetchLike,
    assetReader: assetReader as unknown as AssetReaderLike,
    target,
    facebook: facebook as {
      publishTextForUser: jest.Mock;
      publishPhotoForUser: jest.Mock;
    },
  };
}

describe("MetaProviderExecutor (issue #175)", () => {
  it("publishes through PR #193's encrypted SocialConnection reference", async () => {
    const { executor, facebook, graph } = makeContext({
      target: {
        id: "target-social-1",
        businessId: "biz-1",
        provider: "META",
        channel: "facebook",
        externalAccountId: "page-1",
        connectionState: "CONNECTED",
        credentialRef: "facebook-social-connection:social-1",
        capabilities: ["static_image"],
        expiresAt: null,
      },
    });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-social-1",
    });

    expect(facebook.publishPhotoForUser).toHaveBeenCalledWith({
      userId: "owner-1",
      pageId: "page-1",
      imageUrl: expect.stringContaining("fetch.example.com"),
      caption: "Hello\n#one #two",
    });
    expect(graph.publishFacebookPhoto).not.toHaveBeenCalled();
    expect(result.result.outcome).toBe("published");
  });

  it("publishes an approved text post without requiring or fetching media", async () => {
    const facebook = {
      publishTextForUser: jest.fn(async () => ({
        remotePublicationId: "social-text-1",
        remoteUrl: "https://facebook.example/social-text-1",
      })),
      publishPhotoForUser: jest.fn(),
    };
    const { executor, mediaFetch, assetReader } = makeContext({
      target: {
        id: "target-social-text-1",
        businessId: "biz-1",
        provider: "META",
        channel: "facebook",
        externalAccountId: "page-1",
        connectionState: "CONNECTED",
        credentialRef: "facebook-social-connection:social-1",
        capabilities: ["static_image", "text"],
        expiresAt: null,
      },
      candidate: {
        payload: {
          content_format: "text_post",
          caption: "Text only",
          hashtags: ["#one"],
          assets: [],
        },
      },
      facebook,
    });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-social-text-1",
    });

    expect(facebook.publishTextForUser).toHaveBeenCalledWith({
      userId: "owner-1",
      pageId: "page-1",
      caption: "Text only\n#one",
    });
    expect(facebook.publishPhotoForUser).not.toHaveBeenCalled();
    expect(mediaFetch.buildUrl).not.toHaveBeenCalled();
    expect(assetReader.readApprovedAsset).not.toHaveBeenCalled();
    expect(result.result.outcome).toBe("published");
  });

  it("resolves the exact target's vault credential and publishes server-side", async () => {
    const { executor, graph, mediaFetch, assetReader } = makeContext();

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });

    expect(
      (graph as unknown as GraphLike).publishFacebookPhoto,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        pageToken: "EAA-page-token",
        pageId: "page-1",
        caption: "Hello\n#one #two",
      }),
    );
    expect(
      (mediaFetch as unknown as MediaFetchLike).buildUrl,
    ).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      assetId: "asset-9",
    });
    expect(assetReader.readApprovedAsset).toHaveBeenCalledWith({
      asset_id: "asset-9",
      mime_type: "image/png",
      storage_key: "content/asset-9.png",
      checksum: "abc",
    });
    expect(result.result).toMatchObject({
      contract_version: "publication-result-v1",
      attempt_id: "attempt-1",
      intent_id: "intent-1",
      intent_version: 3,
      outcome: "published",
      provider: "meta",
      remote_publication_id: "post-123",
      remote_url: "https://facebook.example/post-123",
      error_code: null,
      retryable: false,
      reconciliation_required: false,
    });
  });

  it("publishes Instagram through the linked business account token", async () => {
    const { executor, graph } = makeContext({
      target: {
        id: "target-2",
        businessId: "biz-1",
        provider: "META",
        channel: "instagram",
        externalAccountId: "ig-1",
        connectionState: "CONNECTED",
        credentialRef: "vault-1",
        capabilities: ["static_image"],
        expiresAt: null,
      },
      credentialRow: {
        id: "vault-1",
        businessId: "biz-1",
        provider: "META",
        kind: "instagram",
        revokedAt: null,
        ciphertext: makeVault().encrypt(
          JSON.stringify({
            type: "instagram",
            token: "EAA-ig-token",
            igBusinessId: "ig-1",
          }),
        ).ciphertext,
        keyVersion: "v1",
      },
    });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-2",
    });

    expect(
      (graph as unknown as GraphLike).publishInstagramPhoto,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        pageToken: "EAA-ig-token",
        igBusinessId: "ig-1",
      }),
    );
    expect(result.result.outcome).toBe("published");
    expect(result.result.remote_publication_id).toBe("ig-media-1");
  });

  it("fails truthfully when the vault record is missing — NO env fallback", async () => {
    const { executor, graph } = makeContext({ credentialRow: null });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });

    expect(result.result).toMatchObject({
      outcome: "failed",
      error_code: "PUBLISHING_TARGET_UNAUTHORIZED",
      retryable: false,
    });
    expect(
      (graph as unknown as GraphLike).publishFacebookPhoto,
    ).not.toHaveBeenCalled();
  });

  it("fails truthfully on a revoked vault record", async () => {
    const { executor } = makeContext({
      credentialRow: {
        id: "vault-1",
        businessId: "biz-1",
        provider: "META",
        kind: "page",
        revokedAt: new Date(),
        ciphertext: "x.y.z",
        keyVersion: "v1",
      },
    });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });
    expect(result.result.error_code).toBe("PUBLISHING_TARGET_UNAUTHORIZED");
  });

  it("rejects a target that is not CONNECTED or not the attempt's target", async () => {
    const { executor } = makeContext({
      target: {
        id: "target-9",
        businessId: "biz-1",
        provider: "META",
        channel: "facebook",
        externalAccountId: "page-9",
        connectionState: "REVOKED",
        credentialRef: "vault-1",
        capabilities: ["static_image"],
        expiresAt: null,
      },
    });
    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-9",
    });
    expect(result.result.error_code).toBe("PUBLISHING_TARGET_UNAUTHORIZED");

    const wrong = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "some-other-target",
    });
    expect(wrong.result.error_code).toBe("PUBLISHING_TARGET_UNAUTHORIZED");
  });

  it("maps a provider 401 to a non-retryable failed result", async () => {
    const graph = makeGraph({
      publishFacebookPhoto: jest.fn().mockRejectedValue(
        new MetaGraphClientError({
          status: 401,
          code: 190,
          message: "expired",
        }),
      ),
    });
    const { executor } = makeContext({ graph });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });
    expect(result.result).toMatchObject({
      outcome: "failed",
      error_code: "PUBLISHING_TARGET_UNAUTHORIZED",
      retryable: false,
      reconciliation_required: false,
    });
  });

  it("maps a rate limit to a retryable failed result", async () => {
    const graph = makeGraph({
      publishFacebookPhoto: jest
        .fn()
        .mockRejectedValue(
          new MetaGraphClientError({ status: 429, code: 4, message: "rate" }),
        ),
    });
    const { executor } = makeContext({ graph });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });
    expect(result.result).toMatchObject({
      outcome: "failed",
      error_code: "PUBLISHING_PROVIDER_RATE_LIMITED",
      retryable: true,
    });
  });

  it("reports UNKNOWN (reconciliation required) on an unconfirmed provider send", async () => {
    const graph = makeGraph({
      publishFacebookPhoto: jest
        .fn()
        .mockRejectedValue(
          new MetaGraphClientError({ status: 0, code: 0, message: "reset" }),
        ),
    });
    const { executor } = makeContext({ graph });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });
    expect(result.result).toMatchObject({
      outcome: "unknown",
      error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
      retryable: false,
      reconciliation_required: true,
    });
  });

  it("never serializes the token or ciphertext in the result", async () => {
    const { executor } = makeContext();
    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /EAA-page-token|credentialRef|ciphertext/,
    );
  });

  it("fails when the candidate has no publishable asset", async () => {
    const { executor } = makeContext({
      candidate: {
        payload: {
          caption: "x",
          hashtags: [],
          content_format: "static_image_post",
          assets: [],
        },
      },
    });
    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });
    expect(result.result.error_code).toBe("PUBLISHING_ASSET_UNAVAILABLE");
  });

  it("fails with a provider configuration error before reading or sending media", async () => {
    const mediaFetch = {
      ...makeMediaFetch(),
      configurationError: jest.fn(
        () => "PUBLISHING_MEDIA_FETCH_BASE_URL must use HTTPS",
      ),
    };
    const { executor, graph, assetReader } = makeContext({ mediaFetch });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });

    expect(result.result).toMatchObject({
      outcome: "failed",
      error_code: "PUBLISHING_PROVIDER_FAILURE",
      retryable: false,
    });
    expect(assetReader.readApprovedAsset).not.toHaveBeenCalled();
    expect(graph.publishFacebookPhoto).not.toHaveBeenCalled();
  });

  it("blocks a provider call when approved media bytes are unavailable", async () => {
    const assetReader = makeAssetReader({
      readApprovedAsset: jest.fn().mockResolvedValue(null),
    });
    const { executor, graph } = makeContext({ assetReader });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });

    expect(result.result.error_code).toBe("PUBLISHING_ASSET_UNAVAILABLE");
    expect(graph.publishFacebookPhoto).not.toHaveBeenCalled();
  });

  it("preserves an asset tamper failure and never calls Meta", async () => {
    const assetReader = makeAssetReader({
      readApprovedAsset: jest
        .fn()
        .mockRejectedValue(
          new Error("PUBLISHING_ASSET_TAMPERED: approved bytes changed"),
        ),
    });
    const { executor, graph } = makeContext({ assetReader });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });

    expect(result.result.error_code).toBe("PUBLISHING_ASSET_TAMPERED");
    expect(graph.publishFacebookPhoto).not.toHaveBeenCalled();
  });
});
