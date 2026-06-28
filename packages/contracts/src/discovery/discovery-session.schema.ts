import type { DiscoverySessionStatus } from "./discovery-lifecycle";
import type { LanguageMode } from "./prepared-discovery-contracts";

export interface DiscoverySession {
  id: string;
  business_id: string | null;
  owner_user_id: string;
  status: DiscoverySessionStatus;
  language_mode: LanguageMode;
  current_question: string | null;
  profile_draft_id: string | null;
  confirmed_profile_version_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoverySessionCreateInput {
  owner_user_id: string;
  language_mode: LanguageMode;
  business_id?: string;
}

export const SESSION_STATUS_REQUIRES_OWNER: readonly DiscoverySessionStatus[] =
  ["in_progress", "summary_ready", "confirmed"] as const;

export const SESSION_STATUS_TERMINAL: readonly DiscoverySessionStatus[] = [
  "confirmed",
  "failed",
  "cancelled",
] as const;

export function isSessionTerminal(status: DiscoverySessionStatus): boolean {
  return (SESSION_STATUS_TERMINAL as readonly string[]).includes(status);
}

export function isSessionOwnerActionable(
  status: DiscoverySessionStatus,
): boolean {
  return (SESSION_STATUS_REQUIRES_OWNER as readonly string[]).includes(status);
}
