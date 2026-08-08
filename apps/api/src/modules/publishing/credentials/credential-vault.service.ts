import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

/** Raised when a vault record cannot be decrypted (tampered ciphertext, unknown
 *  key version, or missing encryption key). The message is safe to surface as a
 *  stable error code — it never contains ciphertext or token material. */
export class VaultDecryptionError extends Error {
  constructor(message = "PUBLISHING_CREDENTIAL_UNREADABLE") {
    super(message);
    this.name = "VaultDecryptionError";
  }
}

/** Raised when the vault is not configured (no PUBLISHING_VAULT_KEY). */
export class VaultNotConfiguredError extends Error {
  constructor(message = "PUBLISHING_CREDENTIAL_VAULT_NOT_CONFIGURED") {
    super(message);
    this.name = "VaultNotConfiguredError";
  }
}

export interface VaultCiphertext {
  /** base64(iv).base64(authTag).base64(ciphertext) — matches the
   *  PublishingCredential.ciphertext column exactly. */
  readonly ciphertext: string;
  /** Encryption key version that produced `ciphertext`. */
  readonly keyVersion: string;
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * API-owned credential vault (issue #175). Encrypts provider token material at
 * rest with AES-256-GCM using a dedicated deployment key; records store only
 * ciphertext + key version + non-secret metadata. The raw token never appears
 * in PublishingTarget rows, seed data, fixtures, logs, or n8n execution data.
 *
 * Key rotation contract:
 *   - `PUBLISHING_VAULT_KEY` + `PUBLISHING_VAULT_KEY_VERSION` are the CURRENT
 *     encryption key/version. New records always use them.
 *   - `PUBLISHING_VAULT_PREVIOUS_KEYS` (JSON map version → hex key) is accepted
 *     for DECRYPTION ONLY. The rotation script re-encrypts every record under
 *     the current key/version so the previous keys can then be retired.
 */
@Injectable()
export class CredentialVaultService {
  private readonly logger = new Logger(CredentialVaultService.name);
  private readonly currentKey: Buffer;
  private readonly currentVersion: string;
  private readonly previousKeys: ReadonlyMap<string, Buffer>;

  constructor(config: ConfigService) {
    const hexKey = config.get<string>("publishing.vaultKey", "");
    this.currentVersion =
      config.get<string>("publishing.vaultKeyVersion", "") || "v1";
    if (!hexKey) {
      this.logger.error(
        "PUBLISHING_VAULT_KEY is not configured — credential encryption is unavailable (fail closed)",
      );
    }
    this.currentKey = this.parseKey(hexKey, this.currentVersion, true);
    this.previousKeys = this.parsePreviousKeys(
      config.get<string>("publishing.vaultPreviousKeys", "{}"),
    );
  }

  /** True when the vault can encrypt/decrypt (a key is configured). */
  isConfigured(): boolean {
    return this.currentKey.length === 32;
  }

  /** Encrypts plaintext under the current key/version. */
  encrypt(plaintext: string): VaultCiphertext {
    this.assertConfigured();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.currentKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: [
        iv.toString("base64"),
        authTag.toString("base64"),
        encrypted.toString("base64"),
      ].join("."),
      keyVersion: this.currentVersion,
    };
  }

  /** Decrypts a record using its recorded key version (current or previous).
   *  Any integrity failure throws {@link VaultDecryptionError}. */
  decrypt(record: { ciphertext: string; keyVersion: string }): string {
    const key = this.keyForVersion(record.keyVersion);
    if (!key) {
      throw new VaultDecryptionError(
        `PUBLISHING_CREDENTIAL_UNREADABLE: unknown key version ${record.keyVersion}`,
      );
    }
    const parts = record.ciphertext.split(".");
    if (parts.length !== 3) {
      throw new VaultDecryptionError("PUBLISHING_CREDENTIAL_UNREADABLE");
    }
    let iv: Buffer;
    let authTag: Buffer;
    let data: Buffer;
    try {
      iv = Buffer.from(parts[0], "base64");
      authTag = Buffer.from(parts[1], "base64");
      data = Buffer.from(parts[2], "base64");
    } catch (err) {
      throw new VaultDecryptionError("PUBLISHING_CREDENTIAL_UNREADABLE");
    }
    if (iv.length !== IV_LENGTH || authTag.length !== TAG_LENGTH) {
      throw new VaultDecryptionError("PUBLISHING_CREDENTIAL_UNREADABLE");
    }
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]).toString("utf8");
    } catch (err) {
      // GCM auth failure on tampered / wrongly-keyed ciphertext.
      throw new VaultDecryptionError("PUBLISHING_CREDENTIAL_UNREADABLE");
    }
  }

  /**
   * Redacts anything that looks like a credential/token from a string so it can
   * safely reach logs. Conservative: also collapses long opaque token-ish runs.
   */
  static redact(value: string): string {
    return value
      .replace(/EA[A-Za-z0-9]{20,}/g, "[REDACTED-TOKEN]")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/access_token[=:]\s*\S+/gi, "access_token=[REDACTED]")
      .replace(/client_secret[=:]\s*\S+/gi, "client_secret=[REDACTED]");
  }

  private keyForVersion(version: string): Buffer | null {
    if (version === this.currentVersion && this.currentKey.length === 32) {
      return this.currentKey;
    }
    return this.previousKeys.get(version) ?? null;
  }

  private assertConfigured(): void {
    if (this.currentKey.length !== 32) {
      throw new VaultNotConfiguredError();
    }
  }

  private parseKey(hex: string, version: string, required: boolean): Buffer {
    if (!hex) return Buffer.alloc(0);
    const key = Buffer.from(hex, "hex");
    if (key.length !== 32) {
      if (required) {
        throw new Error(
          `PUBLISHING_VAULT_KEY (version ${version}) must be 32 bytes hex — got ${key.length} bytes`,
        );
      }
      return Buffer.alloc(0);
    }
    return key;
  }

  private parsePreviousKeys(raw: string): ReadonlyMap<string, Buffer> {
    let entries: Record<string, string>;
    try {
      entries = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      this.logger.error(
        "PUBLISHING_VAULT_PREVIOUS_KEYS is not valid JSON — ignoring",
      );
      return new Map();
    }
    const map = new Map<string, Buffer>();
    for (const [version, hex] of Object.entries(entries)) {
      if (version === this.currentVersion) continue;
      const key = this.parseKey(hex, version, false);
      if (key.length === 32) map.set(version, key);
    }
    return map;
  }
}
