import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeContentItemVersionChecksum,
  isContentItemVersionChecksumValid,
  normalizeContentTimestamp,
} from "@marketmind/contracts";

type ChecksumVector = {
  readonly name: string;
  readonly item: Record<string, unknown>;
  readonly expected_checksum: string;
};

const vectorsPath = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "contracts",
  "examples",
  "content-item-checksum-vectors.json",
);
const vectors = (
  JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    vectors: ChecksumVector[];
  }
).vectors;

describe("content item version checksum", () => {
  it("matches every fixed cross-language vector", () => {
    for (const vector of vectors) {
      expect(computeContentItemVersionChecksum(vector.item)).toBe(
        vector.expected_checksum,
      );
    }
  });

  it("normalizes equivalent UTC offsets and truncates sub-millisecond precision", () => {
    expect(normalizeContentTimestamp("2026-08-01T04:05:06.789+00:00")).toBe(
      "2026-08-01T04:05:06.789Z",
    );
    expect(
      normalizeContentTimestamp("2026-08-01T07:05:06.123456789+03:00"),
    ).toBe("2026-08-01T04:05:06.123Z");
  });

  it("excludes only the root checksum field", () => {
    const vector = vectors[0];
    const withDifferentRootChecksum = {
      ...vector.item,
      version_checksum: "a-different-root-value",
    };
    expect(computeContentItemVersionChecksum(withDifferentRootChecksum)).toBe(
      vector.expected_checksum,
    );

    const withTamperedNestedValue = {
      ...vector.item,
      metadata: { version_checksum: "tampered-nested-value" },
    };
    expect(computeContentItemVersionChecksum(withTamperedNestedValue)).not.toBe(
      vector.expected_checksum,
    );
  });

  it("invalidates a checksum when an immutable field changes", () => {
    const vector = vectors[0];
    const tampered = {
      ...vector.item,
      caption_variants: [
        {
          locale: "ar",
          caption: "نص مختلف",
          cta: null,
          hashtags: ["#متجر_النور", "#عرض_اليوم"],
        },
      ],
      version_checksum: vector.expected_checksum,
    };
    expect(isContentItemVersionChecksumValid(vector.item)).toBe(false);
    expect(isContentItemVersionChecksumValid(tampered)).toBe(false);
  });
});
