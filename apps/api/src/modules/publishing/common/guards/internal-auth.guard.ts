import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PublishingErrorCode } from "../errors/publishing-error-codes";

/**
 * Guards INTERNAL publishing routes that carry authoritative content-service
 * or runner traffic (candidate ingestion, and later the internal asset route).
 *
 * P1 (#119 review): a candidate must come from the authoritative
 * content-service handoff, NOT an owner browser JWT. An owner JWT must never be
 * able to invent an approved candidate payload/checksum. These internal routes
 * authenticate with a SEPARATE shared bearer token
 * (`PUBLISHING_INTERNAL_SERVICE_TOKEN`) that is distinct from both the owner
 * access JWT and the n8n HMAC signing secret — it is never put on the browser
 * and never reused as a transport credential to n8n. The guard FAILS CLOSED
 * when the token is misconfigured or the request does not present it.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(InternalAuthGuard.name);
  private readonly expectedToken: string;

  constructor(private readonly config: ConfigService) {
    this.expectedToken = this.config.get<string>(
      "publishing.internalServiceToken",
      "",
    );
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.expectedToken) {
      // Fail closed on misconfiguration rather than silently admitting traffic.
      this.logger.error(
        "PUBLISHING_INTERNAL_SERVICE_TOKEN is not configured — refusing internal publishing route",
      );
      throw new UnauthorizedException(PublishingErrorCode.WEBHOOK_UNAUTHORIZED);
    }
    const req = ctx.switchToHttp().getRequest();
    const header = String(req.headers?.["x-publishing-internal-token"] ?? "");
    if (!header || header !== this.expectedToken) {
      this.logger.warn(
        "Internal publishing route rejected: missing/invalid internal service token",
      );
      throw new UnauthorizedException(PublishingErrorCode.WEBHOOK_UNAUTHORIZED);
    }
    return true;
  }
}