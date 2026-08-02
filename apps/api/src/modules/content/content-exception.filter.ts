import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ContentException } from './content.exception';

@Catch(ContentException)
export class ContentExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ContentExceptionFilter.name);

  catch(exception: ContentException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    this.logger.error(
      `[${exception.requestId}] ${exception.code}: ${exception.message}`,
      exception.stack,
    );

    response.status(status).json(exception.toJSON());
  }
}
