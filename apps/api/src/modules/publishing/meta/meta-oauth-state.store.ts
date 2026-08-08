import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import type { MetaOAuthState } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";

export interface MetaOAuthStateInput {
  readonly userId: string;
  readonly businessId: string;
  readonly locale: string | null;
  readonly returnPath: string | null;
  readonly requestedChannel: string | null;
  readonly requestedCapability: string;
  readonly fingerprint: string | null;
}

export interface CreatedMetaOAuthState {
  readonly id: string;
  /** Raw state — sent to Meta in the authorization URL. Only the hash is stored. */
  readonly state: string;
  readonly expiresAt: Date;
}

export interface ConsumedMetaOAuthState {
  readonly id: string;
  readonly userId: string;
  readonly businessId: string;
  readonly locale: string | null;
  readonly returnPath: string | null;
  readonly requestedChannel: string | null;
  readonly requestedCapability: string;
  readonly fingerprint: string | null;
}

/**
 * Single-use OAuth state store (issue #175).
 *
 * The raw state is cryptographically random (256-bit), bound to the owner,
 * business, locale/return path, requested capability, and browser fingerprint,
 * expires quickly, and is consumed ATOMICALLY before any code exchange. The
 * same state can never be replayed: consumption is a compare-and-swap on
 * `consumed_at IS NULL AND expires_at > now`, so a concurrent double callback
 * resolves to exactly one winner.
 */
@Injectable()
export class MetaOAuthStateStore {
  private readonly logger = new Logger(MetaOAuthStateStore.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMs =
      parseInt(
        config.get<string>("publishing.metaOAuthStateTtlMs", "600000"),
        10,
      ) || 600000;
  }

  async create(input: MetaOAuthStateInput): Promise<CreatedMetaOAuthState> {
    const rawState = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlMs);
    const row = await this.prisma.metaOAuthState.create({
      data: {
        stateHash: hashState(rawState),
        userId: input.userId,
        businessId: input.businessId,
        locale: input.locale,
        returnPath: input.returnPath,
        requestedChannel: input.requestedChannel,
        requestedCapability: input.requestedCapability,
        fingerprint: input.fingerprint,
        expiresAt,
      },
    });
    return { id: row.id, state: rawState, expiresAt };
  }

  /**
   * Atomically consumes a state. Returns the bound row only when the state
   * exists, has never been consumed, and is not expired — the compare-and-swap
   * marks it consumed in the SAME statement, so a replay of the same state
   * returns null (protected against replay and cross-tenant reuse).
   */
  async consume(state: string): Promise<ConsumedMetaOAuthState | null> {
    const stateHash = hashState(state);
    const now = new Date();
    const consumed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.metaOAuthState.updateMany({
        where: {
          stateHash,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (update.count !== 1) return null;
      return tx.metaOAuthState.findUnique({ where: { stateHash } });
    });
    if (!consumed) return null;
    return {
      id: consumed.id,
      userId: consumed.userId,
      businessId: consumed.businessId,
      locale: consumed.locale,
      returnPath: consumed.returnPath,
      requestedChannel: consumed.requestedChannel,
      requestedCapability: consumed.requestedCapability,
      fingerprint: consumed.fingerprint,
    };
  }

  /** Marks a state consumed without validating expiry (used when Meta itself
   *  reports a cancellation/denial with a valid state value). */
  async markConsumed(state: string): Promise<void> {
    await this.prisma.metaOAuthState.updateMany({
      where: { stateHash: hashState(state) },
      data: { consumedAt: new Date() },
    });
  }

  /** Read-only lookup by raw state (never consumes). Used only to resolve the
   *  bound locale/connection id for a sanitized cancellation redirect. */
  async peek(state: string): Promise<ConsumedMetaOAuthState | null> {
    const row = await this.prisma.metaOAuthState.findUnique({
      where: { stateHash: hashState(state) },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      businessId: row.businessId,
      locale: row.locale,
      returnPath: row.returnPath,
      requestedChannel: row.requestedChannel,
      requestedCapability: row.requestedCapability,
      fingerprint: row.fingerprint,
    };
  }
}

export function hashState(state: string): string {
  return crypto.createHash("sha256").update(state, "utf8").digest("hex");
}
