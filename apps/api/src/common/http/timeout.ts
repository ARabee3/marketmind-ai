export const withTimeout = (timeoutMs: number): AbortSignal => {
  return AbortSignal.timeout(timeoutMs);
};
