import type {
  PublicationAttemptV1,
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
  PublicationResultV1,
} from "@marketmind/contracts";
import type { PublishingIntentDetailView } from "@/lib/api/publishing";

export type PublishingIntentStateKey = PublicationIntentV1["state"];

/** Stable per-browser connection fingerprint (issue #175): bound to the OAuth
 *  state at connect time and required again at account-selection time, so a
 *  state minted in one browser cannot be replayed from another. */
export function getConnectionFingerprint(): string {
  const KEY = "marketmind.publishing.connection-fingerprint";
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(KEY);
  if (existing) return existing;
  const created = `fp-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(KEY, created);
  return created;
}

export function latestAttempt(
  detail: PublishingIntentDetailView | null,
): PublicationAttemptV1 | null {
  return detail?.attempts.at(-1) ?? null;
}

export function latestResult(
  detail: PublishingIntentDetailView | null,
): PublicationResultV1 | null {
  return detail?.results.at(-1) ?? null;
}

export function activeIntentForCandidate(
  candidate: PublicationCandidateSummaryV1,
  intents: readonly PublicationIntentV1[],
): PublicationIntentV1 | null {
  if (candidate.active_intent_id) {
    const active =
      intents.find(
        (intent) => intent.intent_id === candidate.active_intent_id,
      ) ?? null;
    return active && !isTerminalIntent(active) ? active : null;
  }

  return (
    intents.find(
      (intent) =>
        intent.candidate_id === candidate.candidate.candidate_id &&
        !["cancelled", "succeeded"].includes(intent.state),
    ) ?? null
  );
}

export function isTerminalIntent(intent: PublicationIntentV1 | null): boolean {
  return intent?.state === "succeeded" || intent?.state === "cancelled";
}

export function canRetryIntent(
  intent: PublicationIntentV1 | null,
  detail: PublishingIntentDetailView | null,
): boolean {
  const result = latestResult(detail);
  const attempt = latestAttempt(detail);
  return (
    intent?.state === "failed" &&
    attempt?.state === "failed" &&
    result?.outcome === "failed" &&
    result.retryable === true
  );
}

export function candidateWindowLabel(
  candidate: PublicationCandidateSummaryV1,
): string {
  return `${candidate.candidate.recommended_publish_window.starts_at}|${candidate.candidate.recommended_publish_window.ends_at}`;
}

export function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !value.endsWith("Z") &&
    !/[+-]\d{2}:?\d{2}$/.test(value)
  ) {
    return value.slice(0, 16);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}T${valueFor("hour")}:${valueFor("minute")}`;
}

export function localCairoToUtc(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;

  // Treat the input as a wall-clock value first, then resolve the actual
  // Africa/Cairo offset through the runtime IANA database. Cairo is UTC+02 in
  // winter and UTC+03 during the current summer-DST period; a fixed offset
  // silently shifts schedules by an hour for half of the year.
  const naiveUtcMs = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(naiveUtcMs)) return null;

  const offsetAt = (guessMs: number): number | null => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guessMs));
    const get = (type: string) => {
      const value = parts.find((part) => part.type === type)?.value;
      return value ? Number(value) : NaN;
    };
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const hour = get("hour");
    const minute = get("minute");
    const second = get("second");
    if ([year, month, day, hour, minute, second].some(Number.isNaN)) {
      return null;
    }
    const localMs = Date.UTC(
      year,
      month - 1,
      day,
      hour === 24 ? 0 : hour,
      minute,
      second,
    );
    return guessMs - localMs;
  };

  const offset = offsetAt(naiveUtcMs);
  if (offset === null) return null;
  const utcMs = naiveUtcMs + offset;
  if (offsetAt(utcMs) === offset) {
    return new Date(utcMs).toISOString();
  }

  // Match the API's deterministic DST policy: choose the earlier valid offset
  // for an overlap and reject a nonexistent spring-forward wall-clock value.
  const earlierOffset = offsetAt(naiveUtcMs - 60 * 60 * 1000);
  if (earlierOffset === null) return null;
  const earlierUtcMs = naiveUtcMs + earlierOffset;
  return offsetAt(earlierUtcMs) === earlierOffset
    ? new Date(earlierUtcMs).toISOString()
    : null;
}

export function statusTone(
  state:
    | PublicationIntentV1["state"]
    | PublicationResultV1["outcome"]
    | PublicationAttemptV1["state"],
): "good" | "warning" | "danger" | "neutral" {
  if (["succeeded", "published", "exported", "simulated"].includes(state))
    return "good";
  if (
    ["failed", "unknown", "action_required", "revoked", "replaced"].includes(
      state,
    )
  )
    return "danger";
  if (
    [
      "awaiting_approval",
      "scheduled",
      "dispatching",
      "running",
      "queued",
    ].includes(state)
  )
    return "warning";
  return "neutral";
}
