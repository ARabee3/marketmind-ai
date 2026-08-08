import { MetaProviderExecutor } from "../meta-provider.executor";
import { CredentialVaultService } from "../../credentials/credential-vault.service";
import { ConfigService } from "@nestjs/config";
import { MetaGraphClientError } from "../../meta/meta-graph.client";

const VAULT_KEY =
  "c3b2e6a9d1f47850a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192";

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

type GraphLike = { publishFacebookPhoto: jest.Mock; publishInstagramPhoto: jest.Mock };
type MediaFetchLike = { buildUrl: jest.Mock };

function makeMediaFetch() {
  return {
    buildUrl: jest.fn(() => "https://fetch.example.com/internal/v1/publishing/media-fetch/a?token=x"),
    isConfigured: jest.fn(() => true),
    verify: jest.fn(() => true),
  } as never;
}

function makeContext(overrides: {
  target?: Record<string, unknown>;
  credentialRow?: Record<string, unknown> | null;
  candidate?: Record<string, unknown> | null;
  graph?: unknown;
} = {}) {
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
  const credential = "credentialRow" in overrides ? overrides.credentialRow : {
    id: "vault-1",
    businessId: "biz-1",
    provider: "META",
    kind: "page",
    revokedAt: null,
    ciphertext: makeVault().encrypt(
      JSON.stringify({ type: "page", token: "EAA-page-token", pageId: "page-1" }),
    ).ciphertext,
    keyVersion: "v1",
  };
  const attemptTargetId = overrides.target?.id ?? "target-1";
  const prisma = {
    publishingAttempt: {
      findUnique: jest.fn(async () => ({
        id: "attempt-1",
        intentId: "intent-1",
        intent: { id: "intent-1", targetId: attemptTargetId, version: 3, candidateId: "candidate-1" },
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
                assets: [{ asset_id: "asset-9", checksum: "abc" }],
              },
            }
          : overrides.candidate,
      ),
    },
  };
  const graph = (overrides.graph ?? makeGraph()) as never;
  const mediaFetch = makeMediaFetch();
  const executor = new MetaProviderExecutor(
    prisma as never,
    makeVault(),
    graph,
    mediaFetch,
  );
  return {
    executor,
    prisma,
    graph: graph as unknown as GraphLike,
    mediaFetch: mediaFetch as unknown as MediaFetchLike,
    target,
  };
}

describe("MetaProviderExecutor (issue #175)", () => {
  it("resolves the exact target's vault credential and publishes server-side", async () => {
    const { executor, graph, mediaFetch } = makeContext();

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });

    expect((graph as unknown as GraphLike).publishFacebookPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        pageToken: "EAA-page-token",
        pageId: "page-1",
        caption: "Hello\n#one #two",
      }),
    );
    expect((mediaFetch as unknown as MediaFetchLike).buildUrl).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      assetId: "asset-9",
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
          JSON.stringify({ type: "instagram", token: "EAA-ig-token", igBusinessId: "ig-1" }),
        ).ciphertext,
        keyVersion: "v1",
      },
    });

    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-2",
    });

    expect((graph as unknown as GraphLike).publishInstagramPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: "EAA-ig-token", igBusinessId: "ig-1" }),
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
    expect((graph as unknown as GraphLike).publishFacebookPhoto).not.toHaveBeenCalled();
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
        new MetaGraphClientError({ status: 401, code: 190, message: "expired" }),
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
      publishFacebookPhoto: jest.fn().mockRejectedValue(
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
      publishFacebookPhoto: jest.fn().mockRejectedValue(
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
    expect(JSON.stringify(result)).not.toMatch(/EAA-page-token|credentialRef|ciphertext/);
  });

  it("fails when the candidate has no publishable asset", async () => {
    const { executor } = makeContext({
      candidate: { payload: { caption: "x", hashtags: [], assets: [] } },
    });
    const result = await executor.execute({
      attemptId: "attempt-1",
      intentId: "intent-1",
      targetId: "target-1",
    });
    expect(result.result.error_code).toBe("PUBLISHING_ASSET_UNAVAILABLE");
  });
});
