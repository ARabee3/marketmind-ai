import { Inject, Injectable } from "@nestjs/common";
import type {
  CurrentJourney,
  CurrentJourneyBusinessSummary,
  CurrentJourneyDiscoveryReadiness,
  CurrentJourneyDiscoverySummary,
  CurrentJourneyOwner,
  CurrentJourneyPrimaryAction,
  CurrentJourneyProfileSummary,
  CurrentJourneyResponse,
  CurrentJourneyStrategyContext,
  DiscoverySessionStatus,
  LanguageMode,
} from "@marketmind/contracts";
import {
  JourneyRepository,
  type JourneyCurrentRecord,
  type JourneyRepositoryPort,
  type JourneySessionRecord,
} from "./journey.repository";

@Injectable()
export class JourneyService {
  constructor(
    @Inject(JourneyRepository)
    private readonly repository: JourneyRepositoryPort,
  ) {}

  async getCurrent(ownerUserId: string): Promise<CurrentJourneyResponse> {
    const record = await this.repository.findCurrentForOwner(ownerUserId);
    const journey = currentJourney(record.session);
    const primaryAction = currentAction(journey);

    return {
      owner: currentOwner(record.owner),
      journey,
      future_phase: strategyContext(journey),
      primary_action: primaryAction,
      generated_at: new Date().toISOString(),
    };
  }
}

function currentOwner(owner: JourneyCurrentRecord["owner"]): CurrentJourneyOwner {
  return {
    user_id: owner.id,
    full_name: owner.fullName,
    email: owner.email,
    email_verified: owner.isEmailVerified,
  };
}

function currentJourney(session: JourneySessionRecord | null): CurrentJourney {
  if (!session) {
    return { state: "no_journey", discovery: null, profile: null };
  }

  switch (session.status) {
    case "researching":
    case "partial_ready":
    case "ready_for_chat":
    case "research_failed":
    case "in_progress":
      return {
        state: "discovery_active",
        discovery: discoverySummary(session, session.status),
        profile: null,
      };
    case "summary_ready":
      return {
        state: "discovery_summary_review",
        discovery: discoverySummary(session, session.status),
        profile: null,
      };
    case "confirmed":
      return confirmedJourney(session);
    case "failed":
    case "cancelled":
      return {
        state: "discovery_unavailable",
        discovery: discoverySummary(session, session.status),
        profile: profileSummary(session),
      };
  }
}

function confirmedJourney(session: JourneySessionRecord): CurrentJourney {
  const profile = profileSummary(session);
  if (!profile) {
    return {
      state: "discovery_unavailable",
      discovery: discoverySummary(session, "failed"),
      profile: null,
    };
  }

  return {
    state: "discovery_confirmed",
    discovery: discoverySummary(session, "confirmed"),
    profile,
  };
}

function discoverySummary<TStatus extends Exclude<DiscoverySessionStatus, "not_started">>(
  session: JourneySessionRecord,
  status: TStatus,
): CurrentJourneyDiscoverySummary<TStatus> {
  return {
    session_id: session.id,
    status,
    language_mode: languageMode(session.languageMode),
    business_summary: businessSummary(session),
    readiness: discoveryReadiness(session),
    profile_draft_id: session.profileDraftId,
    confirmed_profile_version_id: session.confirmedProfileVersionId,
    updated_at: session.updatedAt.toISOString(),
    completed_at: session.completedAt?.toISOString() ?? null,
  };
}

function businessSummary(
  session: JourneySessionRecord,
): CurrentJourneyBusinessSummary {
  if (session.intake) {
    return {
      business_name: session.intake.businessName,
      business_type: session.intake.businessType,
      city: session.intake.city,
      area: session.intake.area,
    };
  }

  const business = session.confirmedProfile?.business;
  return {
    business_name: business?.displayName ?? "Unknown business",
    business_type: business?.businessType ?? "Unknown type",
    city: business?.city ?? "Unknown city",
    area: business?.area ?? null,
  };
}

function discoveryReadiness(
  session: JourneySessionRecord,
): CurrentJourneyDiscoveryReadiness {
  return {
    ready: session.profileState.readiness.ready,
    profile_readiness: session.profileState.readiness.profile_readiness,
    owner_turn_count: session.ownerTurnCount,
    max_owner_turns: session.profileState.readiness.max_owner_turns,
  };
}

function profileSummary(
  session: JourneySessionRecord,
): CurrentJourneyProfileSummary | null {
  if (!session.confirmedProfile) {
    return null;
  }

  const profile = session.confirmedProfile;
  return {
    business_profile_version_id: profile.id,
    business_id: profile.businessId,
    version: profile.version,
    business_name: profile.business.displayName,
    business_type: profile.business.businessType,
    city: profile.business.city,
    area: profile.business.area,
    confirmed_at: profile.confirmedAt.toISOString(),
  };
}

function currentAction(journey: CurrentJourney): CurrentJourneyPrimaryAction {
  switch (journey.state) {
    case "no_journey":
      return { type: "start_discovery", destination: "/discovery/new" };
    case "discovery_active":
      return {
        type: "continue_discovery",
        session_id: journey.discovery.session_id,
        destination: `/discovery/${journey.discovery.session_id}`,
      };
    case "discovery_summary_review":
      return {
        type: "review_profile",
        session_id: journey.discovery.session_id,
        destination: `/discovery/${journey.discovery.session_id}`,
      };
    case "discovery_confirmed":
      return {
        type: "view_discovery",
        session_id: journey.discovery.session_id,
        destination: `/discovery/${journey.discovery.session_id}`,
      };
    case "discovery_unavailable":
      return { type: "start_discovery", destination: "/discovery/new" };
  }
}

function strategyContext(
  journey: CurrentJourney,
): CurrentJourneyStrategyContext {
  if (journey.state === "discovery_summary_review") {
    return {
      phase: "strategy",
      availability: "locked",
      status: "needs_brief",
      reason: "profile_review_required",
      destination: null,
    };
  }

  if (journey.state === "discovery_confirmed") {
    return {
      phase: "strategy",
      availability: "unavailable",
      status: "needs_brief",
      reason: "strategy_not_active",
      destination: null,
    };
  }

  return {
    phase: "strategy",
    availability: "locked",
    status: "needs_brief",
    reason: "discovery_required",
    destination: null,
  };
}

function languageMode(value: string): LanguageMode {
  switch (value) {
    case "ar-EG":
    case "en":
    case "mixed":
      return value;
    default:
      return "mixed";
  }
}
