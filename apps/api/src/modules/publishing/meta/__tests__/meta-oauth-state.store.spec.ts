import { ConfigService } from "@nestjs/config";
import { MetaOAuthStateStore } from "../meta-oauth-state.store";

function makeStore(ttlMs = 600000) {
  const rows = new Map<string, Record<string, unknown>>();
  const prisma = {
    metaOAuthState: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `state-${rows.size + 1}`, ...data };
        rows.set(String(data.stateHash), row);
        return row;
      }),
      updateMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const match = rows.get(String(where.stateHash));
        if (!match) return { count: 0 };
        const notConsumed = match.consumedAt == null;
        const notExpired =
          match.expiresAt == null || new Date(match.expiresAt as Date) > new Date();
        if (!notConsumed || !notExpired) return { count: 0 };
        match.consumedAt = new Date();
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return rows.get(String(where.stateHash)) ?? null;
      }),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) =>
      key === "publishing.metaOAuthStateTtlMs" ? String(ttlMs) : fallback,
    ),
  } as unknown as ConfigService;
  return { store: new MetaOAuthStateStore(prisma as never, config), prisma };
}

describe("MetaOAuthStateStore (issue #175)", () => {
  const input = {
    userId: "u1",
    businessId: "b1",
    locale: "ar",
    returnPath: "/publishing",
    requestedChannel: "facebook",
    requestedCapability: "static_image",
    fingerprint: "fp-1",
  };

  it("stores only the SHA-256 hash of the state, never the raw value", async () => {
    const { store, prisma } = makeStore();
    const created = await store.create(input);

    expect(created.state).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(created.state).not.toBe(created.id);
    const stored = (prisma.metaOAuthState.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(stored.stateHash).toHaveLength(64); // sha256 hex
    expect(stored.stateHash).not.toContain(created.state);
    expect(stored.expiresAt).toBeInstanceOf(Date);
  });

  it("consumes a valid state exactly once (replay returns null)", async () => {
    const { store } = makeStore();
    const created = await store.create(input);

    const first = await store.consume(created.state);
    expect(first).toMatchObject({
      userId: "u1",
      businessId: "b1",
      requestedChannel: "facebook",
    });
    const replay = await store.consume(created.state);
    expect(replay).toBeNull();
  });

  it("never consumes an expired state", async () => {
    const { store } = makeStore(-1000); // negative ttl → already expired
    const created = await store.create(input);
    expect(await store.consume(created.state)).toBeNull();
  });

  it("peek reads without consuming", async () => {
    const { store } = makeStore();
    const created = await store.create(input);
    const peeked = await store.peek(created.state);
    expect(peeked?.id).toBe(created.id);
    expect(await store.consume(created.state)).not.toBeNull();
  });

  it("markConsumed invalidates a state for later use", async () => {
    const { store } = makeStore();
    const created = await store.create(input);
    await store.markConsumed(created.state);
    expect(await store.consume(created.state)).toBeNull();
  });
});
