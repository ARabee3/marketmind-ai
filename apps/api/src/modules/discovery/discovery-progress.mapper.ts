import { Prisma } from "@prisma/client";
import { DiscoveryProgressEvent } from "./discovery-state";

export type PersistedProgressEvent = {
  readonly sessionId: string;
  readonly seq: number;
  readonly stage: string;
  readonly status: string;
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload: Prisma.JsonValue;
  readonly createdAt: Date;
};

export function progressEventsFromPersistence(
  events: readonly PersistedProgressEvent[] = [],
): DiscoveryProgressEvent[] {
  return events.map((event) => ({
    type: "progress",
    session_id: event.sessionId,
    seq: event.seq,
    stage: progressStage(event.stage),
    status: progressStatus(event.status),
    message_key: event.messageKey,
    message_text: event.messageText,
    retryable: retryableFromPayload(event.payload),
    payload: metadataFromJson(event.payload),
    created_at: event.createdAt.toISOString(),
  }));
}

function progressStatus(value: string): DiscoveryProgressEvent["status"] {
  switch (value) {
    case "started":
    case "progress":
    case "complete":
    case "failed":
      return value;
    case "completed":
      return "complete";
    default:
      return "started";
  }
}

function progressStage(value: string): DiscoveryProgressEvent["stage"] {
  switch (value) {
    case "session":
      return "queued";
    case "intelligence":
      return "search";
    case "ai_discovery":
      return "ai_start";
    case "background":
      return "failed";
    case "queued":
    case "query_planning":
    case "metadata":
    case "competitor_searching":
    case "search":
    case "filtering":
    case "persisting":
    case "ai_start":
    case "ready":
    case "failed":
      return value;
    default:
      return "failed";
  }
}

function retryableFromPayload(value: Prisma.JsonValue): boolean | undefined {
  const metadata = metadataFromJson(value);
  return typeof metadata["retryable"] === "boolean"
    ? metadata["retryable"]
    : undefined;
}

function metadataFromJson(value: Prisma.JsonValue): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}
