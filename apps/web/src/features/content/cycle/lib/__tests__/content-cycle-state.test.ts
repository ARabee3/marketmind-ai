import { describe, expect, it } from "vitest";
import {
  resolveApprovedContentStrategy,
  buildWeekSlots,
  resolveContentPrimaryAction,
} from "../content-cycle-state";
import {
  mockApprovedStrategyApi,
  mockJourneyNoCycle,
  mockStrategyVersions,
  mockOwnerConfirmedContextWeek1,
  mockQueuedPack,
  mockFailedRetryablePack,
  mockFailedNonRetryablePack,
  mockDraftPack,
  mockActiveCycle,
  MOCK_CYCLE_ID,
  MOCK_STRATEGY_ID,
} from "../content-cycle-fixtures";
import type { CurrentJourneyResponse } from "@marketmind/contracts";
import type { StrategyApiResponse } from "@/lib/api/strategy";

describe("content-cycle-state", () => {
  describe("resolveApprovedContentStrategy", () => {
    it("resolves approved strategy when journey, strategy, and decision match", () => {
      const result = resolveApprovedContentStrategy(
        mockJourneyNoCycle,
        mockApprovedStrategyApi,
        mockStrategyVersions,
      );

      expect("approved" in result).toBe(true);
      if ("approved" in result) {
        expect(result.approved.strategyId).toBe(MOCK_STRATEGY_ID);
        expect(result.approved.brief.plan_language).toBe("ar-EG");
      }
    });

    it("blocks when no profile is present in journey", () => {
      const journey: CurrentJourneyResponse = {
        ...mockJourneyNoCycle,
        journey: {
          state: "no_journey",
          discovery: null,
          profile: null,
        },
      };

      const result = resolveApprovedContentStrategy(
        journey,
        mockApprovedStrategyApi,
        mockStrategyVersions,
      );

      expect("blocker" in result).toBe(true);
      if ("blocker" in result) {
        expect(result.blocker).toBe("no_profile");
      }
    });

    it("blocks when strategy status is not approved", () => {
      const stratApi: StrategyApiResponse = {
        ...mockApprovedStrategyApi,
        status: "in_progress",
      };

      const result = resolveApprovedContentStrategy(
        mockJourneyNoCycle,
        stratApi,
        mockStrategyVersions,
      );

      expect("blocker" in result).toBe(true);
      if ("blocker" in result) {
        expect(result.blocker).toBe("strategy_not_approved");
      }
    });

    it("blocks when approval decision summary is missing or not approved", () => {
      const result = resolveApprovedContentStrategy(
        mockJourneyNoCycle,
        mockApprovedStrategyApi,
        [],
      );

      expect("blocker" in result).toBe(true);
      if ("blocker" in result) {
        expect(result.blocker).toBe("missing_approval_receipt");
      }
    });

    it("blocks when profile version IDs mismatch", () => {
      const stratApi: StrategyApiResponse = {
        ...mockApprovedStrategyApi,
        brief: {
          ...mockApprovedStrategyApi.brief!,
          businessProfileVersionId: "diff-prof-id",
        },
      };

      const result = resolveApprovedContentStrategy(
        mockJourneyNoCycle,
        stratApi,
        mockStrategyVersions,
      );

      expect("blocker" in result).toBe(true);
      if ("blocker" in result) {
        expect(result.blocker).toBe("stale_profile");
      }
    });

    it("blocks when plan roadmap does not have 12 weeks", () => {
      const stratApi: StrategyApiResponse = {
        ...mockApprovedStrategyApi,
        latestPlan: {
          ...mockApprovedStrategyApi.latestPlan!,
          content_strategy: {
            ...mockApprovedStrategyApi.latestPlan!.content_strategy,
            weeks: mockApprovedStrategyApi.latestPlan!.content_strategy.weeks.slice(0, 10),
          },
        },
      };

      const result = resolveApprovedContentStrategy(
        mockJourneyNoCycle,
        stratApi,
        mockStrategyVersions,
      );

      expect("blocker" in result).toBe(true);
      if ("blocker" in result) {
        expect(result.blocker).toBe("malformed_plan");
      }
    });
  });

  describe("buildWeekSlots", () => {
    it("builds exactly 12 week slots", () => {
      const slots = buildWeekSlots(MOCK_CYCLE_ID, 1, 1, [], null);
      expect(slots.length).toBe(12);
      expect(slots.map((s) => s.weekNumber)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
    });

    it("marks current, next, past, and selected weeks", () => {
      const slots = buildWeekSlots(MOCK_CYCLE_ID, 2, 3, [], null);

      expect(slots[0]?.timing).toBe("past");
      expect(slots[1]?.timing).toBe("current");
      expect(slots[2]?.timing).toBe("next");
      expect(slots[2]?.isSelected).toBe(true);
      expect(slots[3]?.timing).toBe("future");
    });

    it("attaches context and pack states correctly", () => {
      const slots = buildWeekSlots(
        MOCK_CYCLE_ID,
        1,
        1,
        [mockOwnerConfirmedContextWeek1],
        mockQueuedPack,
      );

      expect(slots[0]?.context.kind).toBe("owner_confirmed");
      expect(slots[0]?.pack.kind).toBe("known");
      if (slots[0]?.pack.kind === "known") {
        expect(slots[0].pack.status).toBe("queued");
      }

      // Past/current week without known pack is history_unavailable
      expect(slots[1]?.pack.kind).toBe("history_unavailable");
      // Future week > current_week + 1 is not_eligible_yet
      expect(slots[2]?.pack.kind).toBe("not_eligible_yet");
    });
  });

  describe("resolveContentPrimaryAction", () => {
    it("returns none if cycle is not active", () => {
      const action = resolveContentPrimaryAction({
        cycle: { ...mockActiveCycle, status: "completed" },
        selectedWeek: 1,
        hasUnsavedContext: false,
        latestPack: null,
      });

      expect(action).toBe("none");
    });

    it("returns retry_generation for retry_eligible failed pack", () => {
      const action = resolveContentPrimaryAction({
        cycle: mockActiveCycle,
        selectedWeek: 1,
        hasUnsavedContext: false,
        latestPack: mockFailedRetryablePack,
      });

      expect(action).toBe("retry_generation");
    });

    it("returns refresh_status for non-retryable failed pack", () => {
      const action = resolveContentPrimaryAction({
        cycle: mockActiveCycle,
        selectedWeek: 1,
        hasUnsavedContext: false,
        latestPack: mockFailedNonRetryablePack,
      });

      expect(action).toBe("refresh_status");
    });

    it("returns review_pack for draft pack", () => {
      const action = resolveContentPrimaryAction({
        cycle: mockActiveCycle,
        selectedWeek: 1,
        hasUnsavedContext: false,
        latestPack: mockDraftPack,
      });

      expect(action).toBe("review_pack");
    });

    it("returns save_context when unsaved context exists", () => {
      const action = resolveContentPrimaryAction({
        cycle: mockActiveCycle,
        selectedWeek: 2,
        hasUnsavedContext: true,
        latestPack: null,
      });

      expect(action).toBe("save_context");
    });

    it("returns generate_week for exact next eligible week (selectedWeek == current + 1)", () => {
      const action = resolveContentPrimaryAction({
        cycle: mockActiveCycle, // current_week_number = 1
        selectedWeek: 2,
        hasUnsavedContext: false,
        latestPack: null,
      });

      expect(action).toBe("generate_week");
    });

    it("returns none for far future week (selectedWeek > current + 1)", () => {
      const action = resolveContentPrimaryAction({
        cycle: mockActiveCycle, // current_week_number = 1
        selectedWeek: 3,
        hasUnsavedContext: false,
        latestPack: null,
      });

      expect(action).toBe("none");
    });
  });
});
