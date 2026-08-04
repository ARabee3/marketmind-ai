import { deterministicGeneratedAssetId } from "@marketmind/contracts";

describe("deterministicGeneratedAssetId", () => {
  it("matches the UUIDv5 identity used by FastAPI", () => {
    expect(
      deterministicGeneratedAssetId("99999999-9999-4999-8999-999999999999"),
    ).toBe("25f5f5f0-9156-5319-97a5-601a4067faec");
  });

  it("does not vary with an idempotency key", () => {
    const versionId = "99999999-9999-4999-8999-999999999999";
    expect(deterministicGeneratedAssetId(versionId)).toBe(
      deterministicGeneratedAssetId(versionId),
    );
  });
});
