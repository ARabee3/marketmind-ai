import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "../encryption.service";

const TEST_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

function encryption(key: string = TEST_KEY): EncryptionService {
  const configService = {
    get: jest.fn((path: string) =>
      path === "facebook.tokenEncryptionKey" ? key : undefined,
    ),
  } as unknown as ConfigService;
  return new EncryptionService(configService);
}

describe("EncryptionService (facebook Page tokens)", () => {
  it("encrypts and decrypts a token round-trip", () => {
    const service = encryption();
    const token = "EAAG0-very-secret-page-token";

    const encrypted = service.encrypt(token);

    expect(encrypted.ciphertext).not.toContain(token);
    expect(encrypted.iv.length).toBeGreaterThan(0);
    expect(encrypted.authTag.length).toBeGreaterThan(0);
    expect(
      service.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.authTag),
    ).toBe(token);
  });

  it("uses a fresh random IV per encryption (unique ciphertexts)", () => {
    const service = encryption();
    const first = service.encrypt("same-token");
    const second = service.encrypt("same-token");

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.authTag).not.toBe(second.authTag);
  });

  it("throws at construction when the encryption key is not a valid 32-byte hex string", () => {
    const configService = {
      get: jest.fn((path: string) =>
        path === "facebook.tokenEncryptionKey" ? "" : undefined,
      ),
    } as unknown as ConfigService;

    expect(() => new EncryptionService(configService)).toThrow(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars",
    );
  });

  it("rejects trailing data that Node's hex decoder would otherwise ignore", () => {
    expect(() => encryption(`${TEST_KEY}zz`)).toThrow(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars",
    );
  });

  it("throws on tampered ciphertext (auth tag mismatch)", () => {
    const service = encryption();
    const encrypted = service.encrypt("token");
    const tampered = `${encrypted.ciphertext.slice(0, -4)}AAAA`;

    expect(() =>
      service.decrypt(tampered, encrypted.iv, encrypted.authTag),
    ).toThrow();
  });
});
