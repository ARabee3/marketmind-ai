import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  OAuth2Client,
  TokenPayload,
} from "google-auth-library";

import { OAuthException } from "./exceptions/oauth.exception";

/**
 * Normalized Google identity profile extracted from the ID token.
 */
export interface GoogleProfile {
  /** Google's unique subject identifier for the user. */
  providerSubject: string;
  /** Primary email address returned by Google. */
  email: string;
  /** Whether Google has verified the email address. */
  emailVerified: boolean;
  /** Display name from Google, if available. */
  displayName?: string;
  /** URL to the user's avatar image, if available. */
  avatarUrl?: string;
  /** Raw token payload for audit/debugging. */
  rawProfile: Record<string, unknown>;
}

/**
 * Thin wrapper around Google's OAuth2Client.
 *
 * Responsibilities:
 * - Build the authorization URL with a fixed scope and the caller's state.
 * - Exchange the authorization code for an ID token.
 * - Verify the ID token and return a normalized, safe profile.
 *
 * All provider-specific errors are mapped to stable OAuthException codes.
 */
@Injectable()
export class GoogleOAuthClient {
  private readonly logger = new Logger(GoogleOAuthClient.name);
  private readonly client: OAuth2Client;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>("google.clientId");
    const clientSecret = this.configService.get<string>("google.clientSecret");
    const redirectUri = this.configService.get<string>("google.callbackUrl");

    if (!clientId || !clientSecret || !redirectUri) {
      throw new OAuthException(
        "OAUTH_CONFIGURATION_ERROR",
        "Google OAuth is not fully configured (clientId, clientSecret, callbackUrl)",
      );
    }

    this.client = new OAuth2Client(clientId, clientSecret, redirectUri);
  }

  /**
   * Build the Google authorization URL.
   *
   * @param state - The anti-CSRF nonce to pass through the flow.
   * @returns The full URL to redirect the browser to.
   */
  getAuthorizationUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      include_granted_scopes: true,
      state,
    });
  }

  /**
   * Exchange an authorization code for a verified Google profile.
   *
   * @param code - The authorization code from the callback query string.
   * @returns Normalized Google profile.
   * @throws OAuthException on provider errors or invalid tokens.
   */
  async exchangeCode(code: string): Promise<GoogleProfile> {
    let payload: TokenPayload | undefined;

    try {
      const { tokens } = await this.client.getToken(code);
      const idToken = tokens.id_token;

      if (!idToken) {
        throw new OAuthException(
          "OAUTH_PROVIDER_ERROR",
          "Google did not return an ID token",
        );
      }

      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.configService.get<string>("google.clientId"),
      });

      payload = ticket.getPayload() ?? undefined;
    } catch (error) {
      this.logger.warn("Google token exchange/verification failed", error);
      throw this.mapError(error);
    }

    if (!payload) {
      throw new OAuthException(
        "OAUTH_PROVIDER_ERROR",
        "Google ID token payload is empty",
      );
    }

    if (!payload.sub || !payload.email) {
      throw new OAuthException(
        "OAUTH_PROVIDER_ERROR",
        "Google ID token is missing required claims",
      );
    }

    return {
      providerSubject: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      displayName: payload.name ?? undefined,
      avatarUrl: payload.picture ?? undefined,
      rawProfile: payload as unknown as Record<string, unknown>,
    };
  }

  private mapError(error: unknown): OAuthException {
    if (error instanceof OAuthException) {
      return error;
    }

    const message = error instanceof Error ? error.message : "Google OAuth failed";
    return new OAuthException("OAUTH_PROVIDER_ERROR", message);
  }
}
