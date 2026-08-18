/**
 * Meta connection journey contracts (issue #175).
 *
 * These shapes govern the API <-> owner-browser surface for the Meta OAuth
 * connection journey. They are ADDITIVE to the frozen `publishing-v1` boundary
 * (dispatch envelopes, callbacks, results are untouched): the OAuth journey
 * produces ordinary `PublishingTargetV1` projections through the existing
 * frozen pipeline. Nothing in this contract may carry a token, authorization
 * code, ciphertext, or credential reference — the browser sees only connection
 * ids, safe display metadata, capability status, and sanitized result codes.
 */
import type { UUID } from "./publishing-types";

export const META_CONNECTION_CONTRACT_VERSION = "meta-connection-v1";

export type MetaChannel = "facebook" | "instagram";
export type MetaConnectionResultCode =
  | "success"
  | "cancelled"
  | "expired"
  | "denied"
  | "unknown";
export type MetaCapabilityStatus = "supported" | "unsupported";

/** Human-readable blocker codes surfaced to the owner (never provider raw
 *  error payloads). */
export type MetaBlockerCode =
  | "no_page_privilege"
  | "page_publish_capability_missing"
  | "pages_read_engagement_permission_missing"
  | "read_insights_permission_missing"
  | "instagram_not_linked"
  | "instagram_not_professional"
  | "instagram_publish_capability_missing"
  | "authorization_expired";

export type MetaConnectRequestV1 = {
  readonly contract_version: "meta-connection-v1";
  readonly provider: "META";
  readonly channel: MetaChannel;
  readonly locale?: string;
  readonly return_path?: string;
  readonly fingerprint?: string;
};

export type MetaConnectResponseV1 = {
  readonly contract_version: "meta-connection-v1";
  readonly connection_id: UUID;
  readonly authorization_url: string;
  readonly expires_at: string;
};

export type MetaChannelOptionV1 = {
  readonly channel: MetaChannel;
  readonly account_id: string;
  readonly display_name: string;
  readonly capability_status: MetaCapabilityStatus;
  readonly blockers: readonly MetaBlockerCode[];
};

export type MetaPerformanceCapabilityV1 = {
  readonly status: MetaCapabilityStatus;
  readonly blockers: readonly Extract<
    MetaBlockerCode,
    | "no_page_privilege"
    | "pages_read_engagement_permission_missing"
    | "read_insights_permission_missing"
  >[];
};

export type MetaAccountOptionV1 = {
  readonly page: MetaChannelOptionV1;
  readonly instagram: MetaChannelOptionV1 | null;
};

export type MetaPendingSelectionV1 = {
  readonly contract_version: "meta-connection-v1";
  readonly connection_id: UUID;
  readonly requested_channel: MetaChannel | null;
  readonly requested_capability: string;
  readonly expires_at: string | null;
  readonly performance_capability: MetaPerformanceCapabilityV1;
  readonly options: readonly MetaAccountOptionV1[];
};

export type MetaSelectRequestV1 = {
  readonly contract_version: "meta-connection-v1";
  readonly connection_id: UUID;
  readonly page_id: string;
  readonly include_instagram: boolean;
  readonly fingerprint?: string;
};

export type MetaCallbackResultV1 = {
  readonly contract_version: "meta-connection-v1";
  readonly result: MetaConnectionResultCode;
  readonly connection_id: UUID | null;
};

export function validateMetaConnectionResultCode(
  value: unknown,
): value is MetaConnectionResultCode {
  return (
    value === "success" ||
    value === "cancelled" ||
    value === "expired" ||
    value === "denied" ||
    value === "unknown"
  );
}

/** The selection surface must never expose credential material. */
export function assertMetaSelectionIsCredentialFree(
  selection: unknown,
): boolean {
  if (!selection || typeof selection !== "object") return false;
  const raw = JSON.stringify(selection);
  return !/[Ee][Aa][A-Za-z0-9]{8,}/.test(raw) &&
    !/access_token|credential_ref|ciphertext|authorization_code/i.test(raw);
}
