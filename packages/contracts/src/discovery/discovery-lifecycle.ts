export const DISCOVERY_SESSION_STATUSES = [
  "not_started",
  "researching",
  "partial_ready",
  "ready_for_chat",
  "in_progress",
  "summary_ready",
  "confirmed",
  "research_failed",
  "failed",
  "cancelled",
] as const;

export type DiscoverySessionStatus = (typeof DISCOVERY_SESSION_STATUSES)[number];

export const DISCOVERY_PROGRESS_STAGES = [
  "queued",
  "metadata",
  "search",
  "ai_start",
  "ready",
  "failed",
] as const;

export type DiscoveryProgressStage = (typeof DISCOVERY_PROGRESS_STAGES)[number];

export const DISCOVERY_PROGRESS_STATUSES = [
  "started",
  "progress",
  "complete",
  "failed",
] as const;

export type DiscoveryProgressStatus = (typeof DISCOVERY_PROGRESS_STATUSES)[number];

export const DISCOVERY_ALLOWED_TRANSITIONS: Record<
  DiscoverySessionStatus,
  readonly DiscoverySessionStatus[]
> = {
  not_started: ["researching", "cancelled"],
  researching: ["partial_ready", "ready_for_chat", "research_failed", "failed", "cancelled"],
  partial_ready: ["in_progress", "summary_ready", "failed", "cancelled"],
  ready_for_chat: ["in_progress", "summary_ready", "failed", "cancelled"],
  research_failed: ["in_progress", "summary_ready", "failed", "cancelled"],
  in_progress: ["summary_ready", "failed", "cancelled"],
  summary_ready: ["confirmed", "in_progress", "failed", "cancelled"],
  confirmed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionDiscoverySession(
  from: DiscoverySessionStatus,
  to: DiscoverySessionStatus,
): boolean {
  return DISCOVERY_ALLOWED_TRANSITIONS[from].includes(to);
}
