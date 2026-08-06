import type {
  ContentCycle,
  ContentPack,
  ContentPackStatus,
  ContentWeekContext,
  CurrentJourneyResponse,
  StrategyBrief,
  StrategyPlan,
  StrategyVersionSummary,
  WeekPlan,
} from "@marketmind/contracts";
import type { StrategyApiResponse } from "@/lib/api/strategy";
import type { ContentErrorKey } from "./content-cycle-errors";

export type ApprovedContentStrategy = {
  readonly strategyId: string;
  readonly businessId: string;
  readonly strategyVersionId: string;
  readonly strategyVersion: number;
  readonly strategyDecisionId: string;
  readonly decisionAt: string;
  readonly profileVersionId: string;
  readonly profileVersion: number;
  readonly brief: StrategyBrief;
  readonly plan: StrategyPlan;
};

export type ContentEntryBlocker =
  | "no_profile"
  | "no_strategy"
  | "strategy_not_approved"
  | "missing_approval_receipt"
  | "stale_profile"
  | "malformed_plan"
  | "provenance_mismatch";

export type ContentEntryState =
  | { phase: "loading" }
  | { phase: "load_error"; errorKey: ContentErrorKey }
  | { phase: "redirecting"; cycleId: string; week: number }
  | { phase: "blocked"; reason: ContentEntryBlocker; destination: string | null }
  | { phase: "ready_to_start"; approved: ApprovedContentStrategy };

export type ContentWeekSlot = {
  readonly weekNumber: number;
  readonly href: `/content/${string}/weeks/${number}`;
  readonly isSelected: boolean;
  readonly timing: "past" | "current" | "next" | "future";
  readonly context:
    | { kind: "owner_confirmed"; value: ContentWeekContext }
    | { kind: "system_defaulted"; value: ContentWeekContext }
    | { kind: "not_saved" };
  readonly pack:
    | { kind: "known"; id: string; status: ContentPackStatus; pendingDecisions: number | null }
    | { kind: "not_eligible_yet" }
    | { kind: "history_unavailable" };
};

export type ContentWorkspaceSnapshot = {
  readonly cycle: ContentCycle;
  readonly approved: ApprovedContentStrategy;
  readonly contexts: readonly ContentWeekContext[];
  readonly selectedWeek: number;
  readonly latestPack: ContentPack | null;
  readonly latestPackProgress: readonly unknown[];
};

export type ContentWorkspaceState =
  | { phase: "loading" }
  | { phase: "load_error"; errorKey: ContentErrorKey }
  | { phase: "stale_route"; currentCycleId: string | null }
  | { phase: "provenance_blocked"; reason: ContentEntryBlocker }
  | { phase: "ready"; snapshot: ContentWorkspaceSnapshot };

export type ContentPrimaryAction =
  | "go_to_discovery"
  | "go_to_strategy"
  | "review_strategy"
  | "start_cycle"
  | "save_context"
  | "generate_week"
  | "retry_generation"
  | "review_pack"
  | "refresh_status"
  | "none";

/**
 * Validates journey, Strategy resource, and Strategy versions summary against rules in section 9.1.
 */
export function resolveApprovedContentStrategy(
  journey: CurrentJourneyResponse,
  strategyApi: StrategyApiResponse,
  versions: readonly StrategyVersionSummary[],
): { approved: ApprovedContentStrategy } | { blocker: ContentEntryBlocker; destination: string | null } {
  const profile = journey.journey.profile;
  if (!profile || !profile.business_profile_version_id) {
    return { blocker: "no_profile", destination: "/discovery/new" };
  }

  const strategyId = strategyApi.id;
  if (!strategyId || strategyApi.businessId !== profile.business_id) {
    return { blocker: "no_strategy", destination: "/strategy/new" };
  }

  if (strategyApi.status !== "approved") {
    return { blocker: "strategy_not_approved", destination: `/strategy/${strategyId}` };
  }

  const currentVersionId = strategyApi.currentVersionId;
  const brief = strategyApi.brief;
  const plan = strategyApi.latestPlan;

  if (!currentVersionId || !brief || !plan) {
    return { blocker: "missing_approval_receipt", destination: `/strategy/${strategyId}/review` };
  }

  const matchingSummary = versions.find(
    (v) => v.version_id === currentVersionId && v.status === "approved",
  );

  if (!matchingSummary || !matchingSummary.decision || matchingSummary.decision.decision !== "approved") {
    return { blocker: "missing_approval_receipt", destination: `/strategy/${strategyId}/review` };
  }

  if (
    matchingSummary.version !== plan.version ||
    matchingSummary.decision.strategy_version !== plan.version
  ) {
    return { blocker: "provenance_mismatch", destination: `/strategy/${strategyId}` };
  }

  const profileVersionId = profile.business_profile_version_id;
  if (
    matchingSummary.profile_version.business_profile_version_id !== profileVersionId ||
    plan.profile_version.business_profile_version_id !== profileVersionId ||
    brief.businessProfileVersionId !== profileVersionId
  ) {
    return { blocker: "stale_profile", destination: `/strategy/${strategyId}` };
  }

  const weeks = plan.content_strategy?.weeks ?? [];
  if (weeks.length !== 12) {
    return { blocker: "malformed_plan", destination: `/strategy/${strategyId}` };
  }

  for (let i = 1; i <= 12; i++) {
    if (!weeks.some((w: WeekPlan) => w.week_number === i)) {
      return { blocker: "malformed_plan", destination: `/strategy/${strategyId}` };
    }
  }

  const approved: ApprovedContentStrategy = {
    strategyId,
    businessId: strategyApi.businessId,
    strategyVersionId: currentVersionId,
    strategyVersion: plan.version,
    strategyDecisionId: matchingSummary.decision.id,
    decisionAt: matchingSummary.decision.decided_at,
    profileVersionId,
    profileVersion: profile.version,
    brief: {
      id: brief.id,
      strategy_id: brief.strategyId,
      business_profile_version: {
        business_profile_version_id: brief.businessProfileVersionId,
        confirmed_at: brief.businessProfileVersion.confirmedAt,
        version: brief.businessProfileVersion.version,
      },
      primary_objective: brief.primaryObjective as StrategyBrief["primary_objective"],
      start_date: brief.startDate,
      plan_language: brief.planLanguage as StrategyBrief["plan_language"],
      paid_media_allowed: brief.paidMediaAllowed,
      external_budget_mode: brief.externalBudgetMode as StrategyBrief["external_budget_mode"],
      external_budget_egp: brief.externalBudgetEgp as StrategyBrief["external_budget_egp"],
      team_capacity: brief.teamCapacity,
      constraints: typeof brief.constraints === "string" ? [brief.constraints] : (brief.constraints ?? []),
      clarification_answers: [],
      created_at: brief.createdAt,
      updated_at: brief.updatedAt,
    },
    plan,
  };

  return { approved };
}

/**
 * Builds exactly 12 week slots for the 12-week editorial ledger.
 */
export function buildWeekSlots(
  cycleId: string,
  currentWeekNumber: number,
  selectedWeek: number,
  contexts: readonly ContentWeekContext[],
  latestPack: ContentPack | null,
): readonly ContentWeekSlot[] {
  return Array.from({ length: 12 }, (_, index) => {
    const weekNumber = index + 1;
    const isSelected = weekNumber === selectedWeek;

    let timing: ContentWeekSlot["timing"] = "future";
    if (weekNumber < currentWeekNumber) {
      timing = "past";
    } else if (weekNumber === currentWeekNumber) {
      timing = "current";
    } else if (weekNumber === currentWeekNumber + 1) {
      timing = "next";
    }

    const weekContext = contexts.find((c) => c.week_number === weekNumber);
    let context: ContentWeekSlot["context"] = { kind: "not_saved" };
    if (weekContext) {
      if (weekContext.context_source === "owner_confirmed") {
        context = { kind: "owner_confirmed", value: weekContext };
      } else {
        context = { kind: "system_defaulted", value: weekContext };
      }
    }

    let pack: ContentWeekSlot["pack"] = { kind: "history_unavailable" };
    if (latestPack && latestPack.content_cycle_id === cycleId && latestPack.week_number === weekNumber) {
      pack = {
        kind: "known",
        id: latestPack.id,
        status: latestPack.status,
        pendingDecisions: null,
      };
    } else if (weekNumber > currentWeekNumber + 1) {
      pack = { kind: "not_eligible_yet" };
    }

    return {
      weekNumber,
      href: `/content/${cycleId}/weeks/${weekNumber}`,
      isSelected,
      timing,
      context,
      pack,
    };
  });
}

/**
 * Primary action resolver implementing Section 9.4 priorities.
 */
export function resolveContentPrimaryAction(options: {
  cycle: ContentCycle;
  selectedWeek: number;
  hasUnsavedContext: boolean;
  latestPack: ContentPack | null;
  isMutating?: boolean;
}): ContentPrimaryAction {
  const { cycle, selectedWeek, hasUnsavedContext, latestPack } = options;

  if (cycle.status !== "active") {
    return "none";
  }

  // Known pack on the selected week
  if (latestPack && latestPack.content_cycle_id === cycle.id && latestPack.week_number === selectedWeek) {
    if (latestPack.status === "failed") {
      return latestPack.retry_eligible ? "retry_generation" : "refresh_status";
    }
    if (["draft", "partially_approved", "approved"].includes(latestPack.status)) {
      return "review_pack";
    }
    if (["queued", "generating", "validating"].includes(latestPack.status)) {
      return "none";
    }
  }

  // Week 1 generation is queued automatically during cycle creation by backend
  if (selectedWeek === 1 && selectedWeek === cycle.current_week_number) {
    if (hasUnsavedContext) return "save_context";
    if (!latestPack) return "refresh_status";
  }

  // Unsaved context on selected week takes priority if eligible to save
  if (hasUnsavedContext) {
    return "save_context";
  }

  // Generation for exact next eligible week
  if (selectedWeek === cycle.current_week_number + 1 && selectedWeek <= 12) {
    return "generate_week";
  }

  return "none";
}
