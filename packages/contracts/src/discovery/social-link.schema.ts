import type { SocialPlatform } from "./prepared-discovery-contracts";

export type SocialLinkStatus =
  | "pending"
  | "reachable"
  | "unreachable"
  | "discarded";

export interface SocialLink {
  id: string;
  session_id: string;
  business_id: string | null;
  platform: SocialPlatform;
  url: string;
  owner_submitted: boolean;
  status: SocialLinkStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SocialLinkCreateInput {
  session_id: string;
  business_id?: string;
  platform: SocialPlatform;
  url: string;
  owner_submitted: boolean;
  status?: SocialLinkStatus;
  metadata?: Record<string, unknown>;
}
