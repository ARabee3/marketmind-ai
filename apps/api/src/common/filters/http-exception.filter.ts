import {
  type ArgumentsHost,
  Catch,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Response } from "express";

/**
 * Maps NestJS HTTP exceptions to the stable error-code contract expected by
 * the frontend auth flows.
 *
 * Shape: { code: string, message: string, ...extra }
 *
 * Supports custom error codes embedded in exception responses via
 * `{ code: string, message: string }` objects. Any additional custom fields on
 * the exception response object (e.g. `latest_version_id` used by the Content
 * conflict-recovery flow) are preserved, while NestJS boilerplate fields
 * (`statusCode`, `error`) are never forwarded to the client.
 */
@Catch(HttpException)
export class HttpExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const message =
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : (exceptionResponse as { message?: string | string[] }).message ??
          exception.message;

    const code = extractCode(exception, exceptionResponse, message);

    response.status(status).json({
      code,
      message: Array.isArray(message) ? message.join("; ") : message,
      ...extractExtraFields(exceptionResponse),
    });
  }
}

/**
 * Returns any custom fields carried by an object-shaped exception response,
 * excluding the reserved `code`, `message`, `statusCode` and `error` keys so
 * the stable contract is never shadowed by NestJS internals.
 */
function extractExtraFields(
  exceptionResponse: string | object,
): Record<string, unknown> {
  if (typeof exceptionResponse !== "object" || exceptionResponse === null) {
    return {};
  }

  const { statusCode, error, ...rest } = exceptionResponse as Record<
    string,
    unknown
  >;
  void statusCode;
  void error;
  return rest;
}

function extractCode(
  exception: HttpException,
  exceptionResponse: string | object,
  message: string | string[],
): string {
  // If the exception response carries an explicit code, trust it first.
  if (
    typeof exceptionResponse === "object" &&
    exceptionResponse !== null &&
    "code" in exceptionResponse
  ) {
    return (exceptionResponse as { code: string }).code;
  }

  if (exception instanceof UnauthorizedException) {
    return "INVALID_CREDENTIALS";
  }

  if (exception instanceof ConflictException) {
    return "EMAIL_EXISTS";
  }

  if (exception instanceof ServiceUnavailableException) {
    return "REDIS_UNAVAILABLE";
  }

  if (exception instanceof InternalServerErrorException) {
    return "SERVER_ERROR";
  }

  const msg = Array.isArray(message) ? message.join(" ") : message;
  if (/validation|must be|invalid/i.test(msg)) {
    return "VALIDATION_ERROR";
  }

  return "SERVER_ERROR";
}
