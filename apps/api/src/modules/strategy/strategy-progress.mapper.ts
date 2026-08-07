import type {
  StrategyProgressEvent,
  StrategyProgressStage,
  StrategyProgressStatus,
} from "@marketmind/contracts";
import type { PersistedStrategyProgressEvent } from "./strategy.repository";

/**
 * Converts the Prisma representation into the public Strategy progress
 * contract. Keeping this mapping in one place means HTTP snapshots and live
 * Socket.IO events always have identical shapes.
 */
export function strategyProgressEventFromPersistence(
  event: PersistedStrategyProgressEvent,
): StrategyProgressEvent {
  const payload = toPayload(event.payload);
  return {
    type: "strategy_progress",
    strategy_id: event.strategyId,
    seq: event.seq,
    stage: toProgressStage(event.stage),
    status: toProgressStatus(event.status),
    message_key: event.messageKey,
    message_text: event.messageText,
    retryable: payload.retryable === true,
    payload,
    created_at: event.createdAt.toISOString(),
  };
}

export function strategyProgressEventsFromPersistence(
  events: readonly PersistedStrategyProgressEvent[],
): StrategyProgressEvent[] {
  return events.map(strategyProgressEventFromPersistence);
}

function toPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    payload[key] = item;
  }
  return payload;
}

function toProgressStage(value: string): StrategyProgressStage {
  switch (value) {
    case "queued":
      return "queued";
    case "query_planning":
      return "query_planning";
    case "retrieval":
      return "retrieval";
    case "generating":
      return "generating";
    case "validating":
      return "validating";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function toProgressStatus(value: string): StrategyProgressStatus {
  switch (value) {
    case "started":
      return "started";
    case "progress":
      return "progress";
    case "complete":
      return "complete";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}
