import type { SocialPlatform } from "./prepared-discovery-contracts";

export type SocialLinkStatus = "pending" | "reachable" | "unreachable" | "discarded";

export type SocialLinkDiscoveryMethod = "owner_submitted" | "search_found" | "metadata_extracted";

export interface SocialLink {
  id: string;

  session_id: string;

  business_id?: string;

  platform: SocialPlatform;

  url: string;

  display_handle?: string;

  discovery_method: SocialLinkDiscoveryMethod;

  status: SocialLinkStatus;

  metadata: {
    title?: string;
    description?: string;
    og_image?: string;
    og_title?: string;
    follower_count?: number;
    last_post_date?: string;
    phone?: string;
    address?: string;
    business_hours?: string;
    [key: string]: unknown;
  };

  reachable: boolean;

  reachable_checked_at?: string;

  discard_reason?: string;

  created_at: string;

  updated_at: string;
}

export interface SocialLinkCreateInput {
  session_id: string;
  platform: SocialPlatform;
  url: string;
  discovery_method: SocialLinkDiscoveryMethod;
  display_handle?: string;
}

export interface SocialLinkMetadataExtractionResult {
  url: string;
  platform: SocialPlatform;
  reachable: boolean;
  http_status?: number;
  title?: string;
  description?: string;
  og_title?: string;
  og_image?: string;
  extracted_at: string;
  error_code?: string;
  error_message?: string;
}
