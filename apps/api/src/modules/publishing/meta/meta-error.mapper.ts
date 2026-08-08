import { MetaGraphClientError } from "./meta-graph.client";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

export interface MappedMetaError {
  readonly errorCode: string;
  readonly retryable: boolean;
}

/**
 * Maps a normalized Meta Graph failure to the canonical publishing error codes
 * (PUBLISHING_AUTOMATION_ARCHITECTURE.md §12). Mirrors the mapping the old n8n
 * code node applied to raw Graph errors — now owned by the API boundary where
 * the error payload can never reach the browser.
 *
 *   - 401 / expired-session codes (190, 102, 463, 467) → TARGET_UNAUTHORIZED
 *     (authorization is truthfully broken; NOT retryable)
 *   - rate limits (429 / 4, 17, 32, 613)              → PROVIDER_RATE_LIMITED
 *   - everything else                                  → PROVIDER_FAILURE,
 *     retryable only on server-side (>= 500) failures
 */
export function mapMetaGraphError(error: MetaGraphClientError): MappedMetaError {
  const { status, code } = error.info;
  if (status === 401 || [190, 102, 463, 467].includes(code)) {
    return {
      errorCode: PublishingErrorCode.TARGET_UNAUTHORIZED,
      retryable: false,
    };
  }
  if (status === 429 || [4, 17, 32, 613].includes(code)) {
    return {
      errorCode: PublishingErrorCode.PROVIDER_RATE_LIMITED,
      retryable: true,
    };
  }
  return {
    errorCode: PublishingErrorCode.PROVIDER_FAILURE,
    retryable: status >= 500,
  };
}

/** Same mapping for the per-target live verification flow. */
export function mapMetaGraphErrorToConnectionState(
  error: MetaGraphClientError,
): "EXPIRED" | "ERROR" {
  return mapMetaGraphError(error).errorCode ===
    PublishingErrorCode.TARGET_UNAUTHORIZED
    ? "EXPIRED"
    : "ERROR";
}
