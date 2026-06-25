import type { ErrorCode } from "./error-codes";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
}
