import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../common/persistence/prisma.service";

export interface FindOrCreateResult {
  id: string;
  userId: string;
  isNew: boolean;
}

export interface ProviderLookupResult {
  id: string;
  userId: string;
}

/**
 * Manages federated (OAuth) identity links between external providers
 * (Google, future Apple/Facebook) and local User accounts.
 *
 * The composite unique constraint (provider, providerSubject) in the DB
 * ensures no two local accounts can claim the same external identity.
 */
@Injectable()
export class FederatedIdentityService {
  private readonly logger = new Logger(FederatedIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find or create a federated identity link.
   *
   * If the (provider, providerSubject) pair already exists, returns the
   * existing link with isNew = false. Otherwise, creates a new one for
   * the given userId.
   *
   * @throws FederatedIdentityConflictError if the (provider, providerSubject)
   *   pair is already linked to a *different* user (race condition on concurrent
   *   signups with the same Google account).
   */
  async findOrCreate(params: {
    userId: string;
    provider: string;
    providerSubject: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    rawProfile?: Record<string, unknown>;
  }): Promise<FindOrCreateResult> {
    // 1. Check if this provider identity already exists
    const existing = await this.prisma.federatedIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: params.provider,
          providerSubject: params.providerSubject,
        },
      },
      select: { id: true, userId: true },
    });

    if (existing) {
      // The identity exists — if it belongs to a different user, that's a conflict.
      if (existing.userId !== params.userId) {
        throw new FederatedIdentityConflictError(
          params.provider,
          params.providerSubject,
        );
      }
      return { id: existing.id, userId: existing.userId, isNew: false };
    }

    // 2. Create a new link
    try {
      const created = await this.prisma.federatedIdentity.create({
        data: {
          userId: params.userId,
          provider: params.provider,
          providerSubject: params.providerSubject,
          email: params.email,
          displayName: params.displayName,
          avatarUrl: params.avatarUrl,
          rawProfile: (params.rawProfile as Prisma.JsonObject) ?? {},
        },
        select: { id: true, userId: true },
      });

      this.logger.log(
        `Linked ${params.provider} identity to user ${params.userId}`,
      );
      return { id: created.id, userId: created.userId, isNew: true };
    } catch (error) {
      // Handle race condition: another request created the same link
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new FederatedIdentityConflictError(
          params.provider,
          params.providerSubject,
        );
      }
      throw error;
    }
  }

  /**
   * Look up a local user by their federated identity.
   *
   * Used during OAuth login to determine if the user already has an account.
   * Returns null if no link exists.
   */
  async findByProvider(
    provider: string,
    providerSubject: string,
  ): Promise<ProviderLookupResult | null> {
    const identity = await this.prisma.federatedIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider,
          providerSubject,
        },
      },
      select: { id: true, userId: true },
    });

    return identity;
  }
}

/**
 * Thrown when a federated identity is already linked to a different user.
 */
export class FederatedIdentityConflictError extends Error {
  public readonly code = "FEDERATED_IDENTITY_CONFLICT" as const;

  constructor(provider: string, providerSubject: string) {
    super(
      `${provider} identity ${providerSubject} is already linked to another account`,
    );
    this.name = "FederatedIdentityConflictError";
  }
}
