import type {
  PublicationAttemptV1,
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
  PublicationResultV1,
} from "@marketmind/contracts";
import type { PublishingIntentDetailView } from "@/lib/api/publishing";

export type PublishingIntentStateKey = PublicationIntentV1["state"];

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
    return (
      intents.find(
        (intent) => intent.intent_id === candidate.active_intent_id,
      ) ?? null
    );
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
  const date = new Date(`${local}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
