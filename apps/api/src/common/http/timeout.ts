import { DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS } from "../config/external-provider.config";

export const withTimeout = (timeoutMs: number): AbortSignal => {
  const safeTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS;

  return AbortSignal.timeout(safeTimeoutMs);
};
