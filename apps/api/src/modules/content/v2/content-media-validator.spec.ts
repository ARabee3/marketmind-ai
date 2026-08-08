import {
  CONTENT_V2_MEDIA_ALLOWED_MIME_TYPES,
  CONTENT_V2_MEDIA_MAX_BYTES,
} from "@marketmind/contracts";
import {
  ContentMediaValidator,
  normalizeDeclaredMime,
} from "./content-media.repository";

const MINI_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f030005fe02fea72d129c0000000049454e44ae426082",
  "hex",
);

describe("ContentMediaValidator", () => {
  const validator = new ContentMediaValidator();

  it("accepts a valid PNG with declared type", () => {
    const result = validator.validateUpload(MINI_PNG, "image/png");
    expect(result.valid).toBe(true);
    if (result.valid === true) {
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
    }
  });

  it("rejects MIME types outside the allowlist", () => {
    const result = validator.validateUpload(MINI_PNG, "image/gif");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.failureCode).toBe("CONTENT_MEDIA_TYPE_UNSUPPORTED");
    }
  });

  it("rejects a magic-byte mismatch (JPEG bytes claimed as PNG)", () => {
    const jpeg = Buffer.from(
      "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00",
      "hex",
    );
    const result = validator.validateUpload(jpeg, "image/png");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.failureCode).toBe("CONTENT_MEDIA_MAGIC_BYTE_MISMATCH");
    }
  });

  it("rejects uploads above the 10 MiB limit", () => {
    const oversized = Buffer.alloc(CONTENT_V2_MEDIA_MAX_BYTES + 1, 0x89);
    const result = validator.validateUpload(oversized, "image/png");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.failureCode).toBe("CONTENT_MEDIA_TOO_LARGE");
    }
  });

  it("rejects undetectable dimensions", () => {
    const truncated = MINI_PNG.subarray(0, 10);
    const result = validator.validateUpload(truncated, "image/png");
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.failureCode).toBe("CONTENT_MEDIA_DIMENSIONS_INVALID");
    }
  });

  it("computes a stable SHA-256 checksum", () => {
    const first = validator.checksum(MINI_PNG);
    const second = validator.checksum(MINI_PNG);
    expect(first).toHaveLength(64);
    expect(first).toBe(second);
  });

  it("normalizes declared MIME types", () => {
    expect(normalizeDeclaredMime("Image/PNG")).toBe("image/png");
    expect(normalizeDeclaredMime("image/jpeg; charset=binary")).toBe(
      "image/jpeg",
    );
  });

  it("keeps the allowlist contract in sync", () => {
    expect(CONTENT_V2_MEDIA_ALLOWED_MIME_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});
