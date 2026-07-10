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
 * Shape: { code: string, message: string }
 *
 * Supports custom error codes embedded in exception responses via
 * `{ code: string, message: string }` objects.
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
    });
  }
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
