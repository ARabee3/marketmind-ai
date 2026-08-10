import { FacebookOAuthStateStore } from "../facebook-oauth-state.store";

describe("FacebookOAuthStateStore", () => {
  it("stores opaque sessions with a bounded TTL and consumes them atomically", async () => {
    const values = new Map<string, string>();
    const client = {
      setex: jest.fn(async (key: string, ttl: number, value: string) => {
        values.set(key, value);
        expect(ttl).toBe(600);
        return "OK";
      }),
      getdel: jest.fn(async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    };
    const store = new FacebookOAuthStateStore({
      getClient: () => client,
    } as never);

    const start = await store.createStartSession("user-1");
    expect(start).toHaveLength(43);
    expect(client.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^facebook:oauth:start:/),
      600,
      JSON.stringify({ userId: "user-1" }),
    );
    await expect(store.consumeStartSession(start)).resolves.toBe("user-1");
    await expect(store.consumeStartSession(start)).resolves.toBeNull();
    expect(client.getdel).toHaveBeenCalledTimes(2);
  });

  it("keeps OAuth state and popup sessions in separate namespaces", async () => {
    const values = new Map<string, string>();
    const client = {
      setex: jest.fn(async (key: string, _ttl: number, value: string) => {
        values.set(key, value);
        return "OK";
      }),
      getdel: jest.fn(async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    };
    const store = new FacebookOAuthStateStore({
      getClient: () => client,
    } as never);

    const start = await store.createStartSession("start-user");
    const state = await store.createOAuthState("state-user");

    await expect(store.consumeStartSession(start)).resolves.toBe("start-user");
    await expect(store.consumeOAuthState(state)).resolves.toBe("state-user");
    expect([...values.keys()]).toHaveLength(0);
  });

  it("fails closed for malformed, short, missing, or expired values", async () => {
    const values = new Map<string, string>([
      ["facebook:oauth:start:malformed-token", "not-json"],
      ["facebook:oauth:start:missing-user-token", JSON.stringify({})],
    ]);
    const client = {
      setex: jest.fn(),
      getdel: jest.fn(async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    };
    const store = new FacebookOAuthStateStore({
      getClient: () => client,
    } as never);

    await expect(store.consumeStartSession(undefined)).resolves.toBeNull();
    await expect(store.consumeStartSession("short")).resolves.toBeNull();
    await expect(
      store.consumeStartSession("malformed-token"),
    ).resolves.toBeNull();
    await expect(
      store.consumeStartSession("missing-user-token"),
    ).resolves.toBeNull();
    await expect(
      store.consumeStartSession("unknown-token-value"),
    ).resolves.toBeNull();
  });
});
