import type { DiscoverySessionStatus } from "../discovery/discovery-lifecycle";
import type {
  IsoDateTime,
  LanguageMode,
  UUID,
} from "../discovery/prepared-discovery-contracts";
import type { StrategyStatus } from "../strategy/strategy-lifecycle";

export type CurrentJourneyDashboardState =
  | "no_journey"
  | "discovery_active"
  | "discovery_summary_review"
  | "discovery_confirmed"
  | "discovery_unavailable";

export type ActiveDiscoveryStatus = Extract<
  DiscoverySessionStatus,
  | "researching"
  | "partial_ready"
  | "ready_for_chat"
  | "research_failed"
  | "in_progress"
>;

export type UnavailableDiscoveryStatus = Extract<
  DiscoverySessionStatus,
  "failed" | "cancelled"
>;

export type DiscoverySessionDestination = `/discovery/${UUID}`;

export type CurrentJourneyOwner = {
  readonly user_id: UUID;
  readonly full_name: string | null;
  readonly email: string;
  readonly email_verified: boolean;
};

export type CurrentJourneyDiscoveryReadiness = {
  readonly ready: boolean;
  readonly profile_readiness: number;
  readonly owner_turn_count: number;
  readonly max_owner_turns: number;
};

export type CurrentJourneyBusinessSummary = {
  readonly business_name: string;
  readonly business_type: string;
  readonly city: string;
  readonly area: string | null;
};

export type CurrentJourneyDiscoverySummary<
  TStatus extends Exclude<DiscoverySessionStatus, "not_started">,
> = {
  readonly session_id: UUID;
  readonly status: TStatus;
  readonly language_mode: LanguageMode;
  readonly business_summary: CurrentJourneyBusinessSummary;
  readonly readiness: CurrentJourneyDiscoveryReadiness;
  readonly profile_draft_id: UUID | null;
  readonly confirmed_profile_version_id: UUID | null;
  readonly updated_at: IsoDateTime;
  readonly completed_at: IsoDateTime | null;
};

export type CurrentJourneyProfileSummary = {
  readonly business_profile_version_id: UUID;
  readonly business_id: UUID;
  readonly version: number;
  readonly business_name: string;
  readonly business_type: string;
  readonly city: string;
  readonly area: string | null;
  readonly confirmed_at: IsoDateTime;
};

export type CurrentJourney =
  | {
      readonly state: "no_journey";
      readonly discovery: null;
      readonly profile: null;
    }
  | {
      readonly state: "discovery_active";
      readonly discovery: CurrentJourneyDiscoverySummary<ActiveDiscoveryStatus>;
      readonly profile: null;
    }
  | {
      readonly state: "discovery_summary_review";
      readonly discovery: CurrentJourneyDiscoverySummary<"summary_ready">;
      readonly profile: null;
    }
  | {
      readonly state: "discovery_confirmed";
      readonly discovery: CurrentJourneyDiscoverySummary<"confirmed">;
      readonly profile: CurrentJourneyProfileSummary;
    }
  | {
      readonly state: "discovery_unavailable";
      readonly discovery: CurrentJourneyDiscoverySummary<UnavailableDiscoveryStatus>;
      readonly profile: CurrentJourneyProfileSummary | null;
    };

export type CurrentJourneyPrimaryAction =
  | {
      readonly type: "start_discovery";
      readonly destination: "/discovery/new";
    }
  | {
      readonly type: "continue_discovery";
      readonly session_id: UUID;
      readonly destination: DiscoverySessionDestination;
    }
  | {
      readonly type: "review_profile";
      readonly session_id: UUID;
      readonly destination: DiscoverySessionDestination;
    }
  | {
      readonly type: "view_discovery";
      readonly session_id: UUID;
      readonly destination: DiscoverySessionDestination;
    }
  | {
      readonly type: "none";
      readonly destination: null;
    };

export type CurrentJourneyStrategyContext = {
  readonly phase: "strategy";
  readonly availability: "locked" | "unavailable";
  readonly status: Extract<StrategyStatus, "needs_brief">;
  readonly reason:
    | "discovery_required"
    | "profile_review_required"
    | "strategy_not_active";
  readonly destination: null;
};

export type CurrentJourneyResponse = {
  readonly owner: CurrentJourneyOwner;
  readonly journey: CurrentJourney;
  readonly future_phase: CurrentJourneyStrategyContext;
  readonly primary_action: CurrentJourneyPrimaryAction;
  readonly generated_at: IsoDateTime;
};
