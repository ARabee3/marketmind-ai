import { ConfigService } from "@nestjs/config";
import {
  CredentialVaultService,
  VaultDecryptionError,
  VaultNotConfiguredError,
} from "../credential-vault.service";

const TEST_KEY =
  "c3b2e6a9d1f47850a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192";
const TEST_KEY_V2 =
  "301597e64747303ac000bdba1db18719e8da91b4037ef00517b67330e5e4b1ff";

function vault(config: Record<string, string> = {}): CredentialVaultService {
  const configService = {
    get: jest.fn((key: string, fallback?: string) => {
      const map: Record<string, string> = {
        "publishing.vaultKey": TEST_KEY,
        "publishing.vaultKeyVersion": "v1",
        "publishing.vaultPreviousKeys": "{}",
        ...config,
      };
      return map[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  return new CredentialVaultService(configService);
}

describe("CredentialVaultService (issue #175)", () => {
  it("encrypts and decrypts a token bundle round-trip", () => {
    const service = vault();
    const encrypted = service.encrypt(
      JSON.stringify({ type: "page", token: "EAA-super-secret-token" }),
    );

    expect(encrypted.keyVersion).toBe("v1");
    // Ciphertext is opaque: it must never contain the plaintext or look like
    // a token, and it must differ across encryptions (random IV).
    expect(encrypted.ciphertext).not.toContain("EAA-super-secret-token");
    expect(encrypted.ciphertext).not.toContain("page");

    const second = service.encrypt("same payload");
    expect(second.ciphertext).not.toBe(encrypted.ciphertext);

    expect(service.decrypt(encrypted)).toBe(
      JSON.stringify({ type: "page", token: "EAA-super-secret-token" }),
    );
  });

  it("rejects tampered ciphertext (GCM auth failure)", () => {
    const service = vault();
    const encrypted = service.encrypt("token-material");
    const tampered = {
      ...encrypted,
      ciphertext:
        encrypted.ciphertext.slice(0, -2) +
        (encrypted.ciphertext.endsWith("AA") ? "BB" : "AA"),
    };
    expect(() => service.decrypt(tampered)).toThrow(VaultDecryptionError);
  });

  it("rejects malformed ciphertext envelopes", () => {
    const service = vault();
    expect(() =>
      service.decrypt({ ciphertext: "not-a-valid-envelope", keyVersion: "v1" }),
    ).toThrow(VaultDecryptionError);
  });

  it("rejects records encrypted under an unknown key version", () => {
    const service = vault();
    expect(() =>
      service.decrypt({ ciphertext: "a.b.c", keyVersion: "v99" }),
    ).toThrow(VaultDecryptionError);
  });

  it("decrypts legacy records via PUBLISHING_VAULT_PREVIOUS_KEYS (rotation seam)", () => {
    // Simulate a record written under the OLD key before rotation.
    const oldVault = vault({ "publishing.vaultKey": TEST_KEY_V2, "publishing.vaultKeyVersion": "v0" });
    const legacy = oldVault.encrypt("rotated-token");

    // New vault: current key is v1; v0 is a previous (decrypt-only) key.
    const rotated = vault({
      "publishing.vaultPreviousKeys": JSON.stringify({ v0: TEST_KEY_V2 }),
    });
    expect(rotated.decrypt(legacy)).toBe("rotated-token");

    // And the record is re-encryptable under the current key (rotation script
    // behaviour): new record reads back under the CURRENT version.
    const reencrypted = rotated.encrypt(rotated.decrypt(legacy));
    expect(reencrypted.keyVersion).toBe("v1");
    expect(rotated.decrypt(reencrypted)).toBe("rotated-token");
  });

  it("fails closed when no key is configured", () => {
    const service = vault({ "publishing.vaultKey": "" });
    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt("x")).toThrow(VaultNotConfiguredError);
    expect(() =>
      service.decrypt({ ciphertext: "a.b.c", keyVersion: "v1" }),
    ).toThrow(VaultDecryptionError);
  });

  it("redacts token-shaped material for logs", () => {
    expect(
      CredentialVaultService.redact(
        "token=EAAZClongtoken123456789012345678901234567890 and Bearer abc",
      ),
    ).toMatch(/\[REDACTED-TOKEN\]/);
    expect(CredentialVaultService.redact("Bearer xyz")).toContain(
      "Bearer [REDACTED]",
    );
    expect(
      CredentialVaultService.redact("access_token=EAAsecret"),
    ).toContain("[REDACTED]");
  });
});
