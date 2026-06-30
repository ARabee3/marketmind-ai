import { externalProviderConfig } from "./external-provider.config";

describe("externalProviderConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses a valid discovery timeout env value", () => {
    process.env.DISCOVERY_SEARCH_TIMEOUT_MS = "12000";

    expect(externalProviderConfig().discoverySearchTimeoutMs).toBe(12000);
  });

  it.each(["abc", "0", "-1"])(
    "falls back for invalid discovery timeout env value %s",
    (value) => {
      process.env.DISCOVERY_SEARCH_TIMEOUT_MS = value;

      expect(externalProviderConfig().discoverySearchTimeoutMs).toBe(8000);
    },
  );
});
