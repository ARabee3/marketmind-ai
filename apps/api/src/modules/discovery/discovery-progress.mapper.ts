import { Prisma } from "@prisma/client";
import { DiscoveryProgressEvent } from "./discovery-state";

export type PersistedProgressEvent = {
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
): readonly DiscoveryProgressEvent[] {
  return events.map((event) => ({
    seq: event.seq,
    stage: event.stage,
    status: progressStatus(event.status),
    message_key: event.messageKey,
    message_text: event.messageText,
    payload: metadataFromJson(event.payload),
    created_at: event.createdAt.toISOString(),
  }));
}

function progressStatus(value: string): DiscoveryProgressEvent["status"] {
  switch (value) {
    case "started":
    case "completed":
    case "failed":
      return value;
    default:
      return "started";
  }
}

function metadataFromJson(value: Prisma.JsonValue): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}
