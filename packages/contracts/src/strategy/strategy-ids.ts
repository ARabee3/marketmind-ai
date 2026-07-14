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

export type ContractVersion = "strategy-v1";

export type CurrencyCode = "EGP";
