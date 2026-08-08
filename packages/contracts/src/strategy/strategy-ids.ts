import type { UUID, IsoDateTime } from "../discovery/prepared-discovery-contracts";

export type { UUID, IsoDateTime };

export type StrategyId = UUID;
export type StrategyVersionId = UUID;
export type StrategyBriefId = UUID;
export type RetrievalRunId = UUID;

export interface BusinessProfileVersionRef {
  business_profile_version_id: UUID;
  confirmed_at: IsoDateTime;
  version: number;
}

/** Versioned Strategy contract. New Strategies default to `strategy-v2`
 *  after the #135 migration; legacy `strategy-v1` rows are never
 *  reinterpreted (their persisted payloads remain readable exactly as
 *  stored). */
export type ContractVersion = "strategy-v1" | "strategy-v2";

export type CurrencyCode = "EGP";
