import { Controller, Get, Query, Redirect } from "@nestjs/common";
import { MetaConnectionService } from "../targets/meta-connection.service";
import { MetaCallbackQueryDto } from "../targets/targets.dto";

/**
 * API-owned Meta OAuth callback (issue #175).
 *
 * This is a PUBLIC GET endpoint — Meta redirects the owner's browser here
 * after the OAuth round trip, so it intentionally carries NO JWT guard. All
 * security lives in the single-use state:
 *   - `state` is cryptographically random, short-lived, single-use, and bound
 *     to the owner, business, locale/return path, requested capability, and
 *     browser fingerprint;
 *   - it is validated and atomically consumed BEFORE any code exchange;
 *   - the authorization code is exchanged server-to-server and never touches
 *     the browser;
 *   - the redirect back to the web app carries ONLY a connection result id and
 *     a sanitized result code (success | cancelled | expired | denied |
 *     unknown) — never the code, tokens, error_description, or error_reason.
 */
@Controller("publishing-targets/meta/callback")
export class MetaOAuthCallbackController {
  constructor(private readonly metaConnection: MetaConnectionService) {}

  @Get()
  @Redirect()
  handleCallback(
    @Query() query: MetaCallbackQueryDto,
  ): Promise<{ url: string; statusCode: number }> {
    return this.metaConnection
      .handleCallback({
        code: query.code,
        state: query.state,
        error: query.error,
        error_reason: query.error_reason,
        error_description: query.error_description,
      })
      .then((redirect) => ({
        url: redirect.url,
        statusCode: 302,
      }));
  }
}
