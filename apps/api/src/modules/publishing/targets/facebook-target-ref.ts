/**
 * Opaque target credential reference used for the Facebook connection created
 * by PR #193. The value is deliberately not a token and is safe to carry in
 * the frozen dispatch envelope. The provider executor resolves it back to the
 * encrypted SocialConnection row server-side.
 */
export const FACEBOOK_SOCIAL_CONNECTION_REF_PREFIX =
  "facebook-social-connection:";

export function facebookSocialConnectionRef(connectionId: string): string {
  return `${FACEBOOK_SOCIAL_CONNECTION_REF_PREFIX}${connectionId}`;
}

export function socialConnectionIdFromFacebookTargetRef(
  reference: string,
): string | null {
  if (!reference.startsWith(FACEBOOK_SOCIAL_CONNECTION_REF_PREFIX)) {
    return null;
  }
  const id = reference.slice(FACEBOOK_SOCIAL_CONNECTION_REF_PREFIX.length);
  return id || null;
}
