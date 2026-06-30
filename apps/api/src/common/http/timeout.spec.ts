import { withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("falls back when timeout value is invalid", () => {
    expect(() => withTimeout(Number.NaN)).not.toThrow();
    expect(() => withTimeout(0)).not.toThrow();
    expect(() => withTimeout(-1)).not.toThrow();
  });
});
