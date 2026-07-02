export type SafeError = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
};

export const safeError = (
  code: string,
  message: string,
  retryable = false,
): SafeError => ({
  code,
  message,
  retryable,
});
