import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as bcrypt from "bcrypt";
import { Role } from "@prisma/client";

import { PrismaService } from "../../common/persistence/prisma.service";
import { AuthService, SafeUser } from "./auth.service";
import {
  FederatedIdentityConflictError,
  FederatedIdentityService,
} from "./federated-identity.service";
import { GoogleProfile } from "./google-oauth.client";
import { OAuthException } from "./exceptions/oauth.exception";

/**
 * Result of a successful OAuth sign-in.
 */
export interface OAuthSignInResult {
  user: SafeUser;
  isNew: boolean;
  accessToken: string;
  rawRefreshToken: string;
}

/**
 * Applies the safe account policy for Google sign-in.
 *
 * Rules:
 * 1. If a federated identity already exists for the Google subject, sign that
 *    user in.
 * 2. If no identity exists but a local user with the same email exists, reject
 *    the request (no automatic linking).
 * 3. Otherwise create a new verified owner, link the Google identity, and sign
 *    them in.
 */
@Injectable()
export class OAuthAccountPolicyService {
  private readonly logger = new Logger(OAuthAccountPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly federatedIdentity: FederatedIdentityService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Sign in (or sign up) a user using a verified Google profile.
   *
   * @param profile - Normalized Google profile from the ID token.
   * @returns Token pair, safe user, and whether the account is new.
   */
  async signInWithGoogle(profile: GoogleProfile): Promise<OAuthSignInResult> {
    // 1. Returning identity — sign in directly.
    const existingIdentity = await this.federatedIdentity.findByProvider(
      "google",
      profile.providerSubject,
    );

    if (existingIdentity) {
      const user = await this.prisma.user.findUnique({
        where: { id: existingIdentity.userId },
      });

      if (!user) {
        this.logger.error(
          `Federated identity ${existingIdentity.id} references missing user ${existingIdentity.userId}`,
        );
        throw new OAuthException(
          "OAUTH_PROVIDER_ERROR",
          "Linked account not found",
        );
      }

      return this.issueResult(user, false);
    }

    // 2. Same-email password account exists — reject without linking.
    const existingUser = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (existingUser) {
      this.logger.warn(
        `Google OAuth rejected for existing password account: ${profile.email}`,
      );
      throw new OAuthException(
        "OAUTH_EMAIL_ALREADY_USED_PASSWORD",
        "An account with this email already exists. Please sign in with your password.",
      );
    }

    // 3. New user — create a verified owner with an unusable random password.
    const newUser = await this.prisma.user.create({
      data: {
        email: profile.email,
        password: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
        fullName: profile.displayName ?? null,
        isEmailVerified: profile.emailVerified,
      },
    });

    try {
      await this.federatedIdentity.findOrCreate({
        userId: newUser.id,
        provider: "google",
        providerSubject: profile.providerSubject,
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        rawProfile: profile.rawProfile,
      });
    } catch (error) {
      if (error instanceof FederatedIdentityConflictError) {
        // Race: another request created the same Google identity concurrently.
        // Sign in as the user that won the race.
        const raceIdentity = await this.federatedIdentity.findByProvider(
          "google",
          profile.providerSubject,
        );
        if (raceIdentity) {
          const raceUser = await this.prisma.user.findUnique({
            where: { id: raceIdentity.userId },
          });
          if (raceUser) {
            this.logger.warn(
              `Race condition resolved for Google identity ${profile.providerSubject}; signing in existing user`,
            );
            return this.issueResult(raceUser, false);
          }
        }
      }

      // Re-throw unexpected errors (including DB unique violations).
      throw error;
    }

    this.logger.log(`New Google user created: ${newUser.id}`);
    return this.issueResult(newUser, true);
  }

  private async issueResult(
    user: {
      id: string;
      email: string;
      roles: Role[];
      fullName: string | null;
      isEmailVerified: boolean;
      lastLoginAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    isNew: boolean,
  ): Promise<OAuthSignInResult> {
    const tokens = await this.authService.issueTokensForUser(user);
    return {
      user: tokens.user,
      isNew,
      accessToken: tokens.accessToken,
      rawRefreshToken: tokens.rawRefreshToken,
    };
  }
}
