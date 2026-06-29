import { SafeError, safeError } from "./safe-error";

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  toSafeError(): SafeError {
    return safeError(this.code, this.message, this.retryable);
  }
}
