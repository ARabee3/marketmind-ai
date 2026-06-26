import type { DiscoverySessionStatus } from "./discovery-lifecycle";
import type { LanguageMode } from "./prepared-discovery-contracts";
import type {
  PreparedDiscoveryIntake,
  IntelligenceResult,
  DiscoveryMessage,
  BusinessProfileDraft,
  DiscoveryProgressEvent,
} from "./prepared-discovery-contracts";
import type { SocialLink } from "./social-link.schema";
import type { Uncertainty } from "./uncertainty.schema";

export interface DiscoverySession {
  id: string;

  business_id?: string;

  owner_user_id: string;

  status: DiscoverySessionStatus;

  language_mode: LanguageMode;

  current_question?: string;

  intake: PreparedDiscoveryIntake;

  social_links: SocialLink[];

  intelligence: IntelligenceResult;

  uncertainties: Uncertainty[];

  messages: DiscoveryMessage[];

  profile_draft?: BusinessProfileDraft;

  profile_draft_id?: string;

  confirmed_profile_version_id?: string;

  progress_events: DiscoveryProgressEvent[];

  started_at: string;

  completed_at?: string;

  created_at: string;

  updated_at: string;
}

export interface DiscoverySessionCreateInput {
  owner_user_id: string;
  language_mode: LanguageMode;
  intake: PreparedDiscoveryIntake;
}

export interface DiscoverySessionStatusResponse {
  session_id: string;
  status: DiscoverySessionStatus;
  language_mode: LanguageMode;
  current_question?: string;
  intelligence: IntelligenceResult;
  messages: DiscoveryMessage[];
  profile_draft?: BusinessProfileDraft;
  progress_events: DiscoveryProgressEvent[];
  strategy_locked: true;
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
