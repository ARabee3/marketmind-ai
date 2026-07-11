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
    process.env.AI_REQUEST_TIMEOUT_MS = "45000";
    process.env.AI_PROVIDER_RETRY_DELAY_MS = "2500";
    process.env.DISCOVERY_RESEARCH_TIMEOUT_MS = "150000";

    expect(externalProviderConfig().discoverySearchTimeoutMs).toBe(12000);
    expect(externalProviderConfig().aiRequestTimeoutMs).toBe(45000);
    expect(externalProviderConfig().aiProviderRetryDelayMs).toBe(2500);
    expect(externalProviderConfig().discoveryResearchTimeoutMs).toBe(150000);
  });

  it.each(["abc", "0", "-1"])(
    "falls back for invalid discovery timeout env value %s",
    (value) => {
      process.env.DISCOVERY_SEARCH_TIMEOUT_MS = value;

      expect(externalProviderConfig().discoverySearchTimeoutMs).toBe(8000);
    },
  );

  it("uses dedicated defaults for AI requests and total research", () => {
    delete process.env.AI_REQUEST_TIMEOUT_MS;
    delete process.env.AI_PROVIDER_RETRY_DELAY_MS;
    delete process.env.DISCOVERY_RESEARCH_TIMEOUT_MS;

    expect(externalProviderConfig().aiRequestTimeoutMs).toBe(30000);
    expect(externalProviderConfig().aiProviderRetryDelayMs).toBe(3000);
    expect(externalProviderConfig().discoveryResearchTimeoutMs).toBe(180000);
  });
});
