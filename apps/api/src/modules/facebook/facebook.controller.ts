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

function postMessageHtml(message: string, origin: string): string {
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>MarketMind AI — Facebook connection</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem; color: #102A43;">
    <p>You can close this window.</p>
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

  @Get("auth/facebook/start")
  @UseGuards(JwtAuthGuard)
  start(@Req() req: RequestWithUser, @Res() res: Response): void {
    try {
      const url = this.facebookService.buildAuthorizationUrl(req.user.id);
      res.redirect(302, url);
    } catch (error) {
      this.logger.error(
        `Facebook connect start failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res
        .status(200)
        .type("html")
        .send(
          postMessageHtml(
            JSON.stringify({
              type: "fb-connect-error",
              error: "Facebook connection is not available right now.",
            }),
            this.webOrigin,
          ),
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
}
