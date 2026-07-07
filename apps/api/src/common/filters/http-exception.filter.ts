import {
  type ArgumentsHost,
  Catch,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { Response } from "express";

/**
 * Maps NestJS HTTP exceptions to the stable error-code contract expected by
 * the frontend auth flows.
 *
 * Shape: { code: string, message: string }
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

    const code = inferCode(exception, message);

    response.status(status).json({
      code,
      message: Array.isArray(message) ? message.join("; ") : message,
    });
  }
}

function inferCode(
  exception: HttpException,
  message: string | string[],
): string {
  if (exception instanceof UnauthorizedException) {
    return "INVALID_CREDENTIALS";
  }

  if (exception instanceof ConflictException) {
    return "EMAIL_EXISTS";
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
