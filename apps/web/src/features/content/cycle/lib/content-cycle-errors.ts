export type ContentErrorKey =
  | "strategyNotApproved"
  | "profileStale"
  | "cyclePaused"
  | "cycleCompleted"
  | "weekOutOfRange"
  | "weekAlreadyClaimed"
  | "providerFailure"
  | "packNotFailed"
  | "retryNotAllowed"
  | "retryConflict"
  | "badRequest"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "rateLimited"
  | "unavailable"
  | "unknown"
  | "contentV2Required"
  | "provenanceMismatch"
  | "staleRoute"
  | "invalidServerWeek";

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
} | null | undefined;

export function contentErrorKey(err: ErrorLike): ContentErrorKey {
  if (!err) return "unknown";

  const code = err.code ?? "";
  switch (code) {
    case "CONTENT_STRATEGY_NOT_APPROVED":
      return "strategyNotApproved";
    case "CONTENT_PROFILE_STALE":
      return "profileStale";
    case "CONTENT_CYCLE_PAUSED":
      return "cyclePaused";
    case "CONTENT_CYCLE_COMPLETED":
      return "cycleCompleted";
    case "CONTENT_WEEK_OUT_OF_RANGE":
      return "weekOutOfRange";
    case "CONTENT_WEEK_ALREADY_CLAIMED":
      return "weekAlreadyClaimed";
    case "CONTENT_PROVIDER_FAILURE":
      return "providerFailure";
    case "CONTENT_PACK_NOT_FAILED":
      return "packNotFailed";
    case "CONTENT_RETRY_NOT_ALLOWED":
      return "retryNotAllowed";
    case "CONTENT_PACK_RETRY_CONFLICT":
      return "retryConflict";
    case "CONTENT_V2_REQUIRED":
      return "contentV2Required";
  }

  const status = err.status;
  if (status === 400) return "badRequest";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 429) return "rateLimited";
  if (status && status >= 500 && status < 600) return "unavailable";

  return "unknown";
}
