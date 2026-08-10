import { ConfigService } from "@nestjs/config";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { MetaConnectionService } from "../meta-connection.service";
import { CredentialVaultService } from "../../credentials/credential-vault.service";
import { MetaGraphClient } from "../../meta/meta-graph.client";
import { MetaOAuthStateStore } from "../../meta/meta-oauth-state.store";

const VAULT_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

function makeConfig(overrides: Record<string, string> = {}) {
  const map: Record<string, string> = {
    "publishing.webBaseUrl": "https://app.example",
    ...overrides,
  };
  return {
    get: jest.fn((key: string, fallback?: string) => map[key] ?? fallback),
  } as unknown as ConfigService;
}

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

function makeGraph(overrides: Partial<Record<keyof MetaGraphClient, unknown>> = {}) {
  return {
    isConfigured: jest.fn(() => true),
    buildAuthorizationUrl: jest.fn((state: string) => `https://meta.example/oauth?state=${state}`),
    exchangeCodeForLongLivedUserToken: jest.fn(async () => ({
      accessToken: "EAA-long-lived-user-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 24 * 60 * 1000),
      userId: "fb-user-1",
      userName: "Meta Owner",
    })),
    fetchGrantedPermissions: jest.fn(async () => [
      { permission: "pages_show_list", status: "granted" },
      { permission: "pages_manage_posts", status: "granted" },
      { permission: "pages_read_engagement", status: "granted" },
      { permission: "instagram_basic", status: "granted" },
      { permission: "instagram_content_publish", status: "granted" },
    ]),
    listManageablePages: jest.fn(async () => [
      {
        pageId: "page-1",
        name: "Café Page",
        accessToken: "page-token-1",
        instagramBusinessAccount: { id: "ig-1", username: "cafe.eg", name: "Café IG" },
      },
    ]),
    verifyPageAccess: jest.fn(async () => ({ name: "Café Page" })),
    verifyInstagramAccess: jest.fn(async () => ({ username: "cafe.eg" })),
    ...overrides,
  } as unknown as MetaGraphClient;
}

/** Tiny in-memory prisma mock covering the models the service touches. */
function makePrisma() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    publishingTarget: [],
    publishingCredential: [],
    publishingProviderConnection: [],
    publishingConnectionAudit: [],
    publishingIntent: [],
    publishingCandidate: [],
    metaOAuthState: [],
  };
  const nextId = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();

  const applyData = (row: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !Array.isArray(v) && "increment" in (v as object)) {
        row[k] = Number(row[k] ?? 0) + Number((v as { increment: number }).increment);
      } else {
        row[k] = v;
      }
    }
  };

  const model = (name: string) => {
    const rows = tables[name];
    return {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const row = { id: nextId(), ...args.data };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async (args: { where: Record<string, unknown> }) =>
        rows.find((r) => Object.entries(args?.where ?? {}).every(([k, v]) => r[k] === v)) ?? null,
      ),
      findUnique: jest.fn(async (args: { where: string | Record<string, unknown> }) => {
        if (typeof args.where === "string") {
          return rows.find((r) => r.id === args.where) ?? null;
        }
        const where = args.where as Record<string, unknown>;
        return (
          rows.find((r) =>
            Object.entries(where).every(([k, v]) => {
              if (v && typeof v === "object" && !Array.isArray(v)) {
                return Object.entries(v as Record<string, unknown>).every(
                  ([subK, subV]) => r[k] === subV,
                );
              }
              return r[k] === v;
            }),
          ) ?? null
        );
      }),
      findMany: jest.fn(async (args: { where?: Record<string, unknown> } = {}) => {
        const where = args.where ?? {};
        return rows.filter((r) =>
          Object.entries(where).every(([k, v]) => {
            if (v && typeof v === "object" && !Array.isArray(v)) {
              const op = v as Record<string, unknown>;
              if ("not" in op) return r[k] !== op.not;
              if ("in" in op) return (op.in as unknown[]).includes(r[k]);
              return Object.entries(op).every(([subK, subV]) => r[k] === subV);
            }
            return r[k] === v;
          }),
        );
      }),
      update: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = rows.find((r) =>
          Object.entries(args.where).every(([k, v]) => r[k] === v),
        );
        if (!row) throw new Error("P2025: record not found");
        applyData(row, args.data);
        return row;
      }),
      updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of rows) {
          if (Object.entries(args.where).every(([k, v]) => {
            if (v && typeof v === "object" && !Array.isArray(v)) {
              const op = v as Record<string, unknown>;
              if ("in" in op) return (op.in as unknown[]).includes(r[k]);
              return Object.entries(op).every(([subK, subV]) => r[k] === subV);
            }
            return r[k] === v;
          })) {
            applyData(r, args.data);
            count += 1;
          }
        }
        return { count };
      }),
      delete: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const idx = rows.findIndex((r) =>
          Object.entries(args.where).every(([k, v]) => r[k] === v),
        );
        if (idx === -1) throw new Error("P2025: record not found");
        return rows.splice(idx, 1)[0];
      }),
      deleteMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const r = rows[i];
          if (Object.entries(args.where).every(([k, v]) => r[k] === v)) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      }),
      upsert: jest.fn(async (args: {
        where: Record<string, unknown>;
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        const existing = rows.find((r) =>
          Object.entries(args.where).every(([k, v]) => {
            if (v && typeof v === "object" && !Array.isArray(v)) {
              return Object.entries(v as Record<string, unknown>).every(
                ([subK, subV]) => r[k] === subV,
              );
            }
            return r[k] === v;
          }),
        );
        if (existing) {
          applyData(existing, args.update);
          return existing;
        }
        const row = { id: nextId(), ...args.create };
        rows.push(row);
        return row;
      }),
    };
  };

  const prisma = {
    publishingTarget: model("publishingTarget"),
    publishingCredential: model("publishingCredential"),
    publishingProviderConnection: model("publishingProviderConnection"),
    publishingConnectionAudit: model("publishingConnectionAudit"),
    publishingIntent: model("publishingIntent"),
    publishingCandidate: model("publishingCandidate"),
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return { prisma: prisma as never, tables };
}

function makeService(overrides: {
  config?: ConfigService;
  prisma?: unknown;
  graph?: MetaGraphClient;
  stateStore?: { create: jest.Mock; consume: jest.Mock; markConsumed: jest.Mock; peek: jest.Mock };
} = {}) {
  const prisma = (overrides.prisma ?? makePrisma().prisma) as never;
  const config = overrides.config ?? makeConfig();
  const vault = makeVault();
  const graph = overrides.graph ?? makeGraph();
  const stateStore = overrides.stateStore ?? {
    create: jest.fn(async () => ({
      id: "state-row-1",
      state: "raw-state-1",
      expiresAt: new Date(Date.now() + 600000),
    })),
    consume: jest.fn(async () => ({
      id: "state-row-1",
      userId: "owner-1",
      businessId: "biz-1",
      locale: "ar",
      returnPath: "/publishing",
      requestedChannel: "facebook",
      requestedCapability: "static_image",
      fingerprint: "fp-1",
    })),
    markConsumed: jest.fn(async () => undefined),
    peek: jest.fn(async () => null),
  };
  const service = new MetaConnectionService(
    prisma,
    config,
    vault,
    graph,
    stateStore as never,
  );
  return { service, prisma: prisma as any, graph, stateStore, vault };
}

const USER = { businessId: "biz-1", userId: "owner-1" };

describe("MetaConnectionService.initiateConnect", () => {
  it("returns only a connection id + authorization URL", async () => {
    const { service, stateStore } = makeService();
    const result = await service.initiateConnect({
      ...USER,
      provider: "META",
      channel: "facebook",
      locale: "ar",
      fingerprint: "fp-1",
    });

    expect(result.authorization_url).toContain("state=raw-state-1");
    expect(result.connection_id).toBe("state-row-1");
    expect(stateStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner-1",
        businessId: "biz-1",
        requestedChannel: "facebook",
        requestedCapability: "static_image",
        fingerprint: "fp-1",
      }),
    );
  });

  it("rejects unknown provider/channel", async () => {
    const { service } = makeService();
    await expect(
      service.initiateConnect({ ...USER, provider: "TIKTOK", channel: "facebook" }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.initiateConnect({ ...USER, provider: "META", channel: "tiktok" }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("fails closed when Meta app configuration is missing", async () => {
    const graph = makeGraph();
    (graph.isConfigured as jest.Mock).mockReturnValue(false);
    const { service } = makeService({ graph });
    await expect(
      service.initiateConnect({ ...USER, provider: "META", channel: "facebook" }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("allows only the generic publishing or Strategy return paths", async () => {
    const { service, stateStore } = makeService();

    await expect(
      service.initiateConnect({
        ...USER,
        provider: "META",
        channel: "facebook",
        returnPath: "https://evil.example/steal",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "PUBLISHING_META_RETURN_PATH_INVALID",
      }),
    });

    expect(stateStore.create).not.toHaveBeenCalled();

    await service.initiateConnect({
      ...USER,
      provider: "META",
      channel: "instagram",
      locale: "en",
      returnPath: "/strategy/new",
    });
    expect(stateStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "en",
        returnPath: "/strategy/new",
        requestedChannel: "instagram",
      }),
    );
  });
});

describe("MetaConnectionService.handleCallback", () => {
  it("redirects with a sanitized unknown code when state is missing", async () => {
    const { service } = makeService();
    const redirect = await service.handleCallback({ code: "code", error: undefined });
    expect(redirect.url).toContain("meta_result=unknown");
    expect(redirect.url).not.toContain("code");
  });

  it("maps Meta cancellation to a cancelled redirect and consumes the state", async () => {
    const stateStore = {
      create: jest.fn(),
      consume: jest.fn(),
      markConsumed: jest.fn(async () => undefined),
      peek: jest.fn(async () => ({
        id: "state-row-1",
        userId: "owner-1",
        businessId: "biz-1",
        locale: "en",
        returnPath: "/publishing",
        requestedChannel: "facebook",
        requestedCapability: "static_image",
        fingerprint: null,
      })),
    };
    const { service } = makeService({ stateStore });

    const redirect = await service.handleCallback({
      state: "raw-state-1",
      error: "access_denied",
      error_description: "the user denied the app",
    });

    expect(stateStore.markConsumed).toHaveBeenCalledWith("raw-state-1");
    expect(redirect.url).toContain("meta_result=cancelled");
    expect(redirect.url).toContain("/en/publishing/meta/callback");
    // Meta's error text is NEVER echoed back to the browser.
    expect(redirect.url).not.toContain("denied the app");
  });

  it("returns a Strategy callback to the Strategy wizard without exposing provider data", async () => {
    const stateStore = {
      create: jest.fn(),
      consume: jest.fn(),
      markConsumed: jest.fn(async () => undefined),
      peek: jest.fn(async () => ({
        id: "state-row-1",
        userId: "owner-1",
        businessId: "biz-1",
        locale: "en",
        returnPath: "/strategy/new",
        requestedChannel: "instagram",
        requestedCapability: "static_image",
        fingerprint: null,
      })),
    };
    const { service } = makeService({ stateStore });

    const redirect = await service.handleCallback({
      state: "raw-state-1",
      error: "access_denied",
      error_description: "provider details must stay server-side",
    });

    expect(redirect.url).toContain("/en/strategy/new");
    expect(redirect.url).toContain("meta_result=cancelled");
    expect(redirect.url).not.toContain("provider details");
  });

  it("redirects expired when the state is unknown/replayed/expired", async () => {
    const stateStore = {
      create: jest.fn(),
      consume: jest.fn(async () => null),
      markConsumed: jest.fn(),
      peek: jest.fn(async () => null),
    };
    const { service } = makeService({ stateStore });
    const redirect = await service.handleCallback({
      state: "replayed-state",
      code: "code-1",
    });
    expect(redirect.url).toContain("meta_result=expired");
  });

  it("exchanges the code server-side, stores an encrypted user credential, and redirects with only a result code + connection id", async () => {
    const { service, prisma, graph, vault } = makeService();
    const redirect = await service.handleCallback({
      state: "raw-state-1",
      code: "auth-code-1",
    });

    expect(graph.exchangeCodeForLongLivedUserToken).toHaveBeenCalledWith("auth-code-1");
    expect(redirect.url).toContain("meta_result=success");
    expect(redirect.url).toMatch(/meta_connection=id-\d+/);
    expect(redirect.url).not.toContain("auth-code-1");
    expect(redirect.url).not.toContain("EAA-long-lived-user-token");

    const credentials = await (prisma as any).publishingCredential.findMany();
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ kind: "user", provider: "META" });
    // The stored value is ciphertext — the plaintext token never appears.
    expect(credentials[0].ciphertext).not.toContain("EAA-long-lived-user-token");
    expect(vault.decrypt(credentials[0])).toContain("EAA-long-lived-user-token");

    const connections = await (prisma as any).publishingProviderConnection.findMany();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      state: "PENDING_SELECTION",
      userCredentialRef: credentials[0].id,
    });
  });
});

describe("MetaConnectionService.getPendingSelection", () => {
  it("returns safe display metadata + blockers — never tokens", async () => {
    const { service, prisma } = makeService();
    await (prisma as any).publishingProviderConnection.create({
      data: {
        businessId: "biz-1",
        userId: "owner-1",
        provider: "META",
        providerIdentity: "fb-user-1",
        displayName: "Meta Owner",
        externalAccountId: "fb-user-1",
        state: "PENDING_SELECTION",
        userCredentialRef: "cred-1",
      },
    });
    const credential = await (prisma as any).publishingCredential.create({
      data: {
        businessId: "biz-1",
        provider: "META",
        kind: "user",
        keyVersion: "v1",
        ciphertext: "",
      },
    });
    // Encrypt a real user bundle into the credential row.
    credential.ciphertext = new CredentialVaultService(makeConfig({
      "publishing.vaultKey": VAULT_KEY,
      "publishing.vaultKeyVersion": "v1",
    }) as never).encrypt(
      JSON.stringify({
        type: "user",
        token: "EAA-user-token",
        userId: "fb-user-1",
        userName: "Meta Owner",
        expiresAt: new Date().toISOString(),
      }),
    ).ciphertext;
    const conn = (await (prisma as any).publishingProviderConnection.findMany())[0];
    conn.userCredentialRef = credential.id;

    const selection = await service.getPendingSelection({
      ...USER,
      connectionId: conn.id,
      fingerprint: undefined,
    });

    expect(selection.options).toHaveLength(1);
    const option = selection.options[0];
    expect(option.page).toMatchObject({
      channel: "facebook",
      account_id: "page-1",
      display_name: "Café Page",
      capability_status: "supported",
      blockers: [],
    });
    expect(option.instagram).toMatchObject({
      channel: "instagram",
      account_id: "ig-1",
      capability_status: "supported",
    });
    expect(JSON.stringify(selection)).not.toContain("EAA-user-token");
  });

  it("rejects another owner's or another business's pending selection", async () => {
    const { service, prisma } = makeService();
    await (prisma as any).publishingProviderConnection.create({
      data: {
        businessId: "biz-1",
        userId: "owner-1",
        provider: "META",
        providerIdentity: "fb-user-1",
        displayName: "Meta Owner",
        externalAccountId: "fb-user-1",
        state: "PENDING_SELECTION",
      },
    });
    const conn = (await (prisma as any).publishingProviderConnection.findMany())[0];

    await expect(
      service.getPendingSelection({
        businessId: "biz-2",
        userId: "owner-1",
        connectionId: conn.id,
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getPendingSelection({
        businessId: "biz-1",
        userId: "intruder",
        connectionId: conn.id,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe("MetaConnectionService.selectTargets", () => {
  async function seedPending(service: ReturnType<typeof makeService>["service"], prisma: any) {
    await prisma.publishingProviderConnection.create({
      data: {
        businessId: "biz-1",
        userId: "owner-1",
        provider: "META",
        providerIdentity: "fb-user-1",
        displayName: "Meta Owner",
        externalAccountId: "fb-user-1",
        state: "PENDING_SELECTION",
        requestedCapability: "static_image",
        requestedChannel: "facebook",
      },
    });
    const conn = (await prisma.publishingProviderConnection.findMany())[0];
    const credential = await prisma.publishingCredential.create({
      data: {
        businessId: "biz-1",
        provider: "META",
        kind: "user",
        keyVersion: "v1",
        ciphertext: "",
      },
    });
    credential.ciphertext = new CredentialVaultService(makeConfig({
      "publishing.vaultKey": VAULT_KEY,
      "publishing.vaultKeyVersion": "v1",
    }) as never).encrypt(
      JSON.stringify({
        type: "user",
        token: "EAA-user-token",
        userId: "fb-user-1",
        userName: "Meta Owner",
        expiresAt: new Date().toISOString(),
      }),
    ).ciphertext;
    conn.userCredentialRef = credential.id;
    return { conn, credential };
  }

  it("creates CONNECTED targets only after live capability verification, with vault credentialRefs", async () => {
    const { service, prisma } = makeService();
    const { conn } = await seedPending(service, prisma);

    const targets = await service.selectTargets({
      ...USER,
      connectionId: conn.id,
      pageId: "page-1",
      includeInstagram: true,
    });

    expect(targets).toHaveLength(2);
    const [fb, ig] = targets;
    expect(fb).toMatchObject({
      channel: "facebook",
      externalAccountId: "page-1",
      connectionState: "CONNECTED",
      displayName: "Café Page",
    });
    expect(ig).toMatchObject({
      channel: "instagram",
      externalAccountId: "ig-1",
      connectionState: "CONNECTED",
    });
    // Safe projection: credentialRef must be ABSENT from the response.
    expect(JSON.stringify(targets)).not.toContain("credentialRef");

    const storedTargets = await (prisma as any).publishingTarget.findMany();
    expect(storedTargets).toHaveLength(2);
    for (const t of storedTargets) {
      expect(t.credentialRef).toBeTruthy();
      const allCredentials = await (prisma as any).publishingCredential.findMany();
      const vaultRow = allCredentials.find(
        (c: Record<string, unknown>) => c.id === t.credentialRef,
      );
      expect(vaultRow).toBeDefined();
      expect(vaultRow.ciphertext).not.toContain("EAA-user-token");
      expect(vaultRow.ciphertext).not.toContain("page-token-1");
    }
    expect(JSON.stringify(storedTargets)).not.toContain("page-token-1");

    const connRows = await (prisma as any).publishingProviderConnection.findMany();
    // The PENDING row (keyed by the provider user id) is replaced by an ACTIVE
    // row keyed by the selected Page id.
    const activeRow = connRows.find(
      (c: Record<string, unknown>) => c.externalAccountId === "page-1",
    );
    expect(activeRow).toBeDefined();
    expect(activeRow.state).toBe("ACTIVE");
    expect(activeRow.providerIdentity).toBe("fb-user-1");
    expect(activeRow.userCredentialRef).toBeTruthy();
  });

  it("blocks a page the owner cannot publish to", async () => {
    const graph = makeGraph();
    (graph.listManageablePages as jest.Mock).mockResolvedValue([
      { pageId: "page-1", name: "No privilege", accessToken: null, instagramBusinessAccount: null },
    ]);
    const { service, prisma } = makeService({ graph });
    const { conn } = await seedPending(service, prisma);

    await expect(
      service.selectTargets({
        ...USER,
        connectionId: conn.id,
        pageId: "page-1",
        includeInstagram: false,
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("blocks Instagram when the page has no linked professional account", async () => {
    const graph = makeGraph();
    (graph.listManageablePages as jest.Mock).mockResolvedValue([
      { pageId: "page-1", name: "Page", accessToken: "tok", instagramBusinessAccount: null },
    ]);
    const { service, prisma } = makeService({ graph });
    const { conn } = await seedPending(service, prisma);

    await expect(
      service.selectTargets({
        ...USER,
        connectionId: conn.id,
        pageId: "page-1",
        includeInstagram: true,
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("refuses to silently connect a SECOND page while another account is active", async () => {
    const graph = makeGraph();
    (graph.listManageablePages as jest.Mock).mockResolvedValue([
      { pageId: "page-2", name: "Other Page", accessToken: "tok", instagramBusinessAccount: null },
    ]);
    const { service, prisma } = makeService({ graph });
    const { conn } = await seedPending(service, prisma);
    // Existing ACTIVE target on a different page.
    await (prisma as any).publishingTarget.create({
      data: {
        businessId: "biz-1",
        provider: "META",
        channel: "facebook",
        externalAccountId: "page-1",
        displayName: "Café Page",
        connectionState: "CONNECTED",
        credentialRef: "old-vault",
      },
    });

    await expect(
      service.selectTargets({
        ...USER,
        connectionId: conn.id,
        pageId: "page-2",
        includeInstagram: false,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe("MetaConnectionService.disconnectTarget", () => {
  it("cancels scheduled real intents, revokes the target, and deletes the unused credential", async () => {
    const { service, prisma } = makeService();
    await (prisma as any).publishingCredential.create({
      data: {
        id: "vault-1",
        businessId: "biz-1",
        provider: "META",
        kind: "page",
        keyVersion: "v1",
        ciphertext: "a.b.c",
      },
    });
    await (prisma as any).publishingTarget.create({
      data: {
        id: "target-1",
        businessId: "biz-1",
        provider: "META",
        channel: "facebook",
        externalAccountId: "page-1",
        displayName: "Café Page",
        connectionState: "CONNECTED",
        credentialRef: "vault-1",
        capabilities: ["static_image"],
      },
    });
    await (prisma as any).publishingIntent.create({
      data: {
        id: "intent-1",
        businessId: "biz-1",
        targetId: "target-1",
        status: "SCHEDULED",
      },
    });
    await (prisma as any).publishingIntent.create({
      data: {
        id: "intent-2",
        businessId: "biz-1",
        targetId: "target-1",
        status: "AWAITING_APPROVAL",
      },
    });
    await (prisma as any).publishingIntent.create({
      data: {
        id: "intent-3",
        businessId: "biz-1",
        targetId: "target-1",
        status: "SUCCEEDED",
      },
    });

    const result = await service.disconnectTarget({
      targetId: "target-1",
      businessId: "biz-1",
      userId: "owner-1",
    });

    expect(result.connectionState).toBe("REVOKED");
    const intents = await (prisma as any).publishingIntent.findMany();
    expect(intents.find((i: any) => i.id === "intent-1").status).toBe("CANCELLED");
    expect(intents.find((i: any) => i.id === "intent-2").status).toBe("CANCELLED");
    // Terminal intents are untouched.
    expect(intents.find((i: any) => i.id === "intent-3").status).toBe("SUCCEEDED");
    // The credential is deleted (no other target uses it).
    expect(await (prisma as any).publishingCredential.findMany()).toHaveLength(0);
    const audits = await (prisma as any).publishingConnectionAudit.findMany();
    expect(audits.at(-1)).toMatchObject({
      action: "DISCONNECTED",
      detail: expect.objectContaining({ cancelled_scheduled_intents: 2 }),
    });
  });
});

describe("MetaConnectionService.verifyTargetLive", () => {
  async function seedConnected(service: ReturnType<typeof makeService>["service"], prisma: any) {
    const encrypted = makeVault().encrypt(
      JSON.stringify({ type: "page", token: "EAA-page-token", pageId: "page-1" }),
    );
    const credential = await prisma.publishingCredential.create({
      data: {
        businessId: "biz-1",
        provider: "META",
        kind: "page",
        keyVersion: encrypted.keyVersion,
        ciphertext: encrypted.ciphertext,
      },
    });
    const target = await prisma.publishingTarget.create({
      data: {
        id: "target-1",
        businessId: "biz-1",
        provider: "META",
        channel: "facebook",
        externalAccountId: "page-1",
        displayName: "Café Page",
        connectionState: "CONNECTED",
        credentialRef: credential.id,
        capabilities: ["static_image"],
        version: 1,
      },
    });
    return target;
  }

  it("stamps verified only after a live provider round-trip", async () => {
    const { service, prisma, graph } = makeService();
    await seedConnected(service, prisma);

    const result = await service.verifyTargetLive({
      targetId: "target-1",
      businessId: "biz-1",
      expectedVersion: 1,
      actorUserId: "owner-1",
    });

    expect(graph.verifyPageAccess).toHaveBeenCalledWith("EAA-page-token", "page-1");
    expect(result.target.lastVerifiedAt).toBeInstanceOf(Date);
    expect(result.target.version).toBe(2);
  });

  it("blocks on version conflict", async () => {
    const { service, prisma } = makeService();
    await seedConnected(service, prisma);
    await expect(
      service.verifyTargetLive({
        targetId: "target-1",
        businessId: "biz-1",
        expectedVersion: 99,
        actorUserId: "owner-1",
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("turns an expired authorization into a truthful EXPIRED state that blocks real publishing", async () => {
    const { MetaGraphClientError } = await import("../../meta/meta-graph.client");
    const graph = makeGraph();
    (graph.verifyPageAccess as jest.Mock).mockRejectedValue(
      new MetaGraphClientError({ status: 401, code: 190, message: "expired" }),
    );
    const { service, prisma } = makeService({ graph });
    await seedConnected(service, prisma);

    await expect(
      service.verifyTargetLive({
        targetId: "target-1",
        businessId: "biz-1",
        expectedVersion: 1,
        actorUserId: "owner-1",
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    const stored = (await (prisma as any).publishingTarget.findMany())[0];
    expect(stored.connectionState).toBe("EXPIRED");
  });

  it("marks an unreadable credential as ERROR (never env fallback)", async () => {
    const { service, prisma } = makeService();
    await seedConnected(service, prisma);
    // Corrupt the stored ciphertext.
    const credential = (await (prisma as any).publishingCredential.findMany())[0];
    credential.ciphertext = "corrupted.a.b";

    await expect(
      service.verifyTargetLive({
        targetId: "target-1",
        businessId: "biz-1",
        expectedVersion: 1,
        actorUserId: "owner-1",
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect((await (prisma as any).publishingTarget.findMany())[0].connectionState).toBe("ERROR");
  });
});
