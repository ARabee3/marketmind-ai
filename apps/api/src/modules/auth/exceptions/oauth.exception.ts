import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Domain exception for OAuth flow failures.
 *
 * Carries a stable error code string so the HttpExceptionFilter can return
 * a frontend-safe { code, message } shape. The canonical list of codes lives
 * in @marketmind/contracts/src/errors/error-codes.ts.
 */
export class OAuthException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details: Record<string, unknown> = {},
  ) {
    super({ code, message, ...details }, status);
  }
}
