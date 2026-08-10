import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * AES-256-GCM encryption helper for Facebook Page access tokens.
 *
 * The Page token MUST be reversible (decryptable) — never hashed — because
 * the raw token is required to call the Graph API at publish/test time.
 *
 * - 32-byte key read from `TOKEN_ENCRYPTION_KEY` (hex-encoded env var);
 * - a fresh random 12-byte IV is generated per encryption;
 * - ciphertext / IV / authTag are stored as base64 strings.
 * - Throws at construction when the key is not a valid 32-byte hex string so
 *   the app fails fast on misconfiguration.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const rawKey = config.get<string>("facebook.tokenEncryptionKey") ?? "";
    if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
      throw new Error(
        "TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars",
      );
    }
    this.key = Buffer.from(rawKey, "hex");
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(ciphertext: string, iv: string, authTag: string): string {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
