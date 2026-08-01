import {
  type ArgumentsHost,
  Catch,
  HttpException,
  Logger,
} from "@nestjs/common";
import { Response } from "express";
import { HttpExceptionFilter } from "./http-exception.filter";

/**
 * Last-resort global filter for exceptions that are NOT HttpException
 * (Prisma validation errors, unexpected runtime errors, etc.).
 *
 * The HttpExceptionFilter already maps every HTTP exception to the stable
 * `{ code, message }` contract. This filter ensures anything that escapes it
 * still reaches the frontend as a stable, friendly response instead of the
 * default NestJS "Internal Server Error" body — while the real cause is logged
 * server-side for debugging.
 */
@Catch()
export class AllExceptionsFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly httpExceptionFilter = new HttpExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      this.httpExceptionFilter.catch(exception, host);
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    this.logger.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    );

    response.status(500).json({
      code: "SERVER_ERROR",
      message: "An unexpected error occurred. Please try again later.",
    });
  }
}
