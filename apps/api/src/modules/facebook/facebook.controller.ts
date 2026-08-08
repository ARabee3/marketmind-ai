import {
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { FacebookService } from "./facebook.service";

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

/** HttpOnly cookie carrying the short-lived start session for the popup. */
export const FB_START_SESSION_COOKIE = "fb_connect_start";

function postMessageHtml(message: string, origin: string): string {
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>MarketMind AI — Facebook connection</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem; color: #102A43;">
    <p>You can close this window.</p>
    <p style="margin-top:1rem">
      <a href="#" onclick="window.close();return false" style="color:#0B6F71">Close this window</a>
    </p>
    <script>
      (function () {
        var message = ${message};
        try {
          window.opener.postMessage(message, ${JSON.stringify(origin)});
        } catch (e) {
          // The popup may already be closed; the wizard also handles timeout.
        }
        window.close();
      })();
    </script>
  </body>
</html>`;
}

/**
 * Facebook Page connection routes (one Page per user, dev milestone).
 *
 * - `GET /auth/facebook/start` — authenticated; redirects the popup to the
 *   Facebook OAuth dialog with a single-use state bound to the user.
 * - `GET /auth/facebook/callback` — PUBLIC (Facebook redirects the browser
 *   here); validates state, exchanges the code server-to-server, upserts the
 *   connection, and posts the result back to the opener popup.
 * - `GET /connections` — authenticated; current connection (or null).
 * - `POST /connections/facebook/test` — authenticated; publishes a test post.
 * - `DELETE /connections/facebook` — authenticated; removes the connection.
 */
@Controller()
export class FacebookController {
  private readonly logger = new Logger(FacebookController.name);

  constructor(
    private readonly facebookService: FacebookService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Authenticated (Bearer) session bootstrap: issues a short-lived,
   * single-use start token in an HttpOnly cookie. The popup then opens
   * `GET /auth/facebook/start` — a plain browser navigation that cannot
   * carry the Authorization header — and the cookie is used instead to
   * resolve the owning user.
   */
  @Post("auth/facebook/start")
  @UseGuards(JwtAuthGuard)
  startSession(@Req() req: RequestWithUser, @Res() res: Response): void {
    const token = this.facebookService.createStartSession(req.user.id);
    res.cookie(FB_START_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get<boolean>("cookies.secure", false),
      sameSite: this.config.get<"lax" | "strict" | "none">(
        "cookies.sameSite",
        "lax",
      ),
      path: "/",
      maxAge: 10 * 60 * 1000,
    });
    res.status(204).send();
  }

  /**
   * Popup entry point (browser navigation, no Bearer header): consumes the
   * start-session cookie, builds the Facebook OAuth dialog URL, and redirects
   * the popup to Facebook. On any failure the popup receives the
   * fb-connect-error postMessage and closes.
   */
  @Get("auth/facebook/start")
  start(@Req() req: Request, @Res() res: Response): void {
    const userId = this.facebookService.consumeStartSession(
      req.cookies?.[FB_START_SESSION_COOKIE],
    );
    if (!userId) {
      this.sendConnectError(
        res,
        "The connection request expired. Please try again.",
      );
      return;
    }
    res.clearCookie(FB_START_SESSION_COOKIE, {
      httpOnly: true,
      secure: this.config.get<boolean>("cookies.secure", false),
      sameSite: this.config.get<"lax" | "strict" | "none">(
        "cookies.sameSite",
        "lax",
      ),
      path: "/",
    });
    try {
      const url = this.facebookService.buildAuthorizationUrl(userId);
      res.redirect(302, url);
    } catch (error) {
      this.logger.error(
        `Facebook connect start failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.sendConnectError(
        res,
        "Facebook connection is not available right now.",
      );
    }
  }

  @Get("auth/facebook/callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) {
      res.status(400).type("html").send(
        postMessageHtml(
          JSON.stringify({
            type: "fb-connect-error",
            error: "The connection request is missing required data.",
          }),
          this.webOrigin,
        ),
      );
      return;
    }

    const result = await this.facebookService.handleCallback(code, state);
    const message =
      result.ok === true
        ? JSON.stringify({
            type: "fb-connected",
            payload: { pageName: result.pageName },
          })
        : JSON.stringify({
            type: "fb-connect-error",
            error: result.error,
          });

    res.status(200).type("html").send(postMessageHtml(message, this.webOrigin));
  }

  @Get("connections")
  @UseGuards(JwtAuthGuard)
  getConnection(@Req() req: RequestWithUser) {
    return this.facebookService.getConnection(req.user.id);
  }

  @Post("connections/facebook/test")
  @UseGuards(JwtAuthGuard)
  testConnection(@Req() req: RequestWithUser) {
    return this.facebookService.testConnection(req.user.id);
  }

  @Delete("connections/facebook")
  @UseGuards(JwtAuthGuard)
  disconnect(@Req() req: RequestWithUser) {
    return this.facebookService.disconnect(req.user.id);
  }

  private get webOrigin(): string {
    return this.config.get<string>("cors.origin") ?? "http://localhost:3000";
  }

  private sendConnectError(res: Response, error: string): void {
    res.status(200).type("html").send(
      postMessageHtml(
        JSON.stringify({ type: "fb-connect-error", error }),
        this.webOrigin,
      ),
    );
  }
}
