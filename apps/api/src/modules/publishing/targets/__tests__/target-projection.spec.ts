import { toTargetProjection } from "../targets.service";
import type { PublishingTarget } from "@prisma/client";

/** Build a fake PublishingTarget including credentialRef */
function makeTarget(
  overrides: Partial<PublishingTarget> = {},
): PublishingTarget {
  return {
    id: "target-1",
    businessId: "biz-1",
    provider: "META",
    channel: "facebook",
    externalAccountId: "page-123",
    displayName: "My Page",
    connectionState: "CONNECTED",
    credentialRef: "secret-vault-ref-abc123", // must never appear in projection
    capabilities: ["static_image"],
    lastVerifiedAt: null,
    expiresAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as PublishingTarget;
}

describe("toTargetProjection (allow-list projector)", () => {
  it("returns all expected safe fields", () => {
    const target = makeTarget();
    const projection = toTargetProjection(target);

    expect(projection.id).toBe("target-1");
    expect(projection.businessId).toBe("biz-1");
    expect(projection.provider).toBe("META");
    expect(projection.channel).toBe("facebook");
    expect(projection.connectionState).toBe("CONNECTED");
    expect(projection.capabilities).toEqual(["static_image"]);
  });

  it("NEVER includes credentialRef in the projection", () => {
    const target = makeTarget({ credentialRef: "super-secret-token" });
    const projection = toTargetProjection(target);

    // The projection object must NOT have credentialRef at all
    expect(Object.keys(projection)).not.toContain("credentialRef");
    // And the value must not appear even under another key
    const json = JSON.stringify(projection);
    expect(json).not.toContain("super-secret-token");
  });

  it("does not leak credentialRef when a new field is added via spread", () => {
    // If the projector used spread operator it would leak new fields automatically.
    // This test adds a hypothetical new sensitive field and verifies it is absent.
    const targetWithExtra = {
      ...makeTarget(),
      newSensitiveField: "leak-me",
    };
    // Cast to force the projector to run against the extended object
    const projection = toTargetProjection(
      targetWithExtra as unknown as PublishingTarget,
    );
    expect(Object.keys(projection)).not.toContain("newSensitiveField");
  });
});
