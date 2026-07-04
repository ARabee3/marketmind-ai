import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";

const WINDOW_MS = 60_000;
const MAX_POSTS_PER_WINDOW = 20;

type RequestWithUser = Request & {
  readonly user?: AuthenticatedUser;
};

type RateEntry = {
  readonly resetAt: number;
  readonly count: number;
};

@Injectable()
export class DiscoveryRateLimitGuard implements CanActivate {
  private readonly entries = new Map<string, RateEntry>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.method !== "POST") {
      return true;
    }

    const key = this.keyFor(request);
    const now = Date.now();
    const current = this.entries.get(key);
    const next =
      current && current.resetAt > now
        ? { resetAt: current.resetAt, count: current.count + 1 }
        : { resetAt: now + WINDOW_MS, count: 1 };

    this.entries.set(key, next);

    if (next.count > MAX_POSTS_PER_WINDOW) {
      throw new HttpException(
        "Too many discovery requests",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private keyFor(request: RequestWithUser): string {
    const ownerKey = request.user?.id ?? request.ip ?? "anonymous";
    const routeKey = request.route?.path ?? request.path;

    return `${ownerKey}:${request.method}:${routeKey}`;
  }
}
