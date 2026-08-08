import { configuration } from "./configuration";

describe("configuration Content v2 default", () => {
  const originalValue = process.env.CONTENT_V2_DEFAULT_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.CONTENT_V2_DEFAULT_ENABLED;
    } else {
      process.env.CONTENT_V2_DEFAULT_ENABLED = originalValue;
    }
  });

  it("enables content v2 when the flag is omitted", () => {
    delete process.env.CONTENT_V2_DEFAULT_ENABLED;

    expect(configuration().content.v2DefaultEnabled).toBe(true);
  });

  it("keeps the legacy path behind an explicit false override", () => {
    process.env.CONTENT_V2_DEFAULT_ENABLED = "false";

    expect(configuration().content.v2DefaultEnabled).toBe(false);
  });

  it("accepts an explicit true override", () => {
    process.env.CONTENT_V2_DEFAULT_ENABLED = "true";

    expect(configuration().content.v2DefaultEnabled).toBe(true);
  });
});
