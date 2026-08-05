import { HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface ContentExceptionDetails {
  field?: string;
  [key: string]: unknown;
}

export class ContentException extends HttpException {
  public readonly requestId: string;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details: ContentExceptionDetails;

  constructor(
    code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    retryable = false,
    details: ContentExceptionDetails = {},
  ) {
    super(message, status);
    this.requestId = randomUUID();
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.name = 'ContentException';
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        request_id: this.requestId,
        retryable: this.retryable,
        details: this.details,
      },
    };
  }
}
