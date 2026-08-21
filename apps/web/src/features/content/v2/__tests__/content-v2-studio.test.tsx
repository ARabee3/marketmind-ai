import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ContentCycleWorkspaceV2 } from "@marketmind/contracts";
import { ContentV2Studio } from "../content-v2-studio";
import * as contentV2Api from "@/lib/api/content-v2";
import * as contentCycleApi from "@/lib/api/content-cycle";

const mockPush = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const map: Record<string, string> = {
      "ContentV2.studio.eyebrow": "Content studio",
      "ContentV2.studio.loading": "Loading studio…",
      "ContentV2.studio.currentWeekLabel": "This week",
      "ContentV2.studio.weekBadge": "Week {week}",
      "ContentV2.studio.goalLabel": "This week's goal",
      "ContentV2.studio.previousWeeksLabel": "Previous weeks",
      "ContentV2.studio.historyEmpty": "No previous weeks yet.",
      "ContentV2.studio.nextWeekLabel": "Next week",
      "ContentV2.studio.nextPreview": "Next week is a preview.",
      "ContentV2.studio.whyThisWeek": "Why this week?",
      "ContentV2.studio.whyThisWeekHelp": "Context",
      "ContentV2.studio.focusLabel": "Focus",
      "ContentV2.studio.outcomeLabel": "Outcome",
      "ContentV2.studio.measurementLabel": "Measurement",
      "ContentV2.studio.adviceLabel": "Owner advice",
      "ContentV2.studio.defaultVoiceHint":
        "Suggestions use a default voice derived from your approved strategy.",
      "ContentV2.studio.notPlannedHint":
        "We'll suggest 3–5 post cards for this week.",
      "ContentV2.studio.planCta": "Plan this week",
      "ContentV2.studio.planningCta": "Planning…",
      "ContentV2.studio.replanCta": "Re-plan",
      "ContentV2.studio.generateCta": "Generate drafts",
      "ContentV2.studio.weekCost": "This week will use 2 points",
      "ContentV2.studio.confirmTitle": "Confirm point usage",
      "ContentV2.studio.confirmBody":
        "Generating this week's drafts will use {points} points. You have {balance} points.",
      "ContentV2.studio.confirmBodyNoBalance":
        "Generating this week's drafts will use {points} points.",
      "ContentV2.studio.confirmInsufficient":
        "You need {points} points but you have {balance}. Top up to continue.",
      "ContentV2.studio.confirmCancel": "Cancel",
      "ContentV2.studio.confirmCta": "Confirm and generate",
      "ContentV2.studio.insufficientPoints":
        "You need points. Top up to continue.",
      "ContentV2.studio.topUpCta": "Top up points",
      "ContentV2.studio.reviewCta": "Review drafts",
      "ContentV2.studio.viewApprovedCta": "View approved posts",
      "ContentV2.studio.completedHint": "All posts for this week are approved.",
      "ContentV2.studio.retryCta": "Retry this week's generation",
      "ContentV2.studio.regenerateCta": "Generate fresh drafts",
      "ContentV2.studio.regeneratingCta": "Starting fresh generation…",
      "ContentV2.studio.recoveryTitle": "The drafts could not be created",
      "ContentV2.studio.recoveryBody":
        "The generation checks stopped unsafe or invalid drafts before anything was saved.",
      "ContentV2.studio.recoveryPlanSafe":
        "Your reviewed post plan is still intact, and nothing was published.",
      "ContentV2.studio.configureProfileCta": "Editorial settings",
      "ContentV2.studio.ctaGuidanceTitle": "Give every post a clear next step",
      "ContentV2.studio.ctaGuidanceBody":
        "Open the CTA library before planning.",
      "ContentV2.studio.ctaGuidanceCta": "Open CTA library",
      "ContentV2.studio.viewFullStrategy": "View full strategy",
      "ContentV2.studio.generationState.not_started": "Not planned",
      "ContentV2.studio.generationState.planned":
        "Planned — ready for your review",
      "ContentV2.studio.generationState.queued": "Queued for generation",
      "ContentV2.studio.generationState.generating": "Generating drafts…",
      "ContentV2.studio.generationState.ready": "Drafts ready for review",
      "ContentV2.studio.generationState.completed": "Week completed",
      "ContentV2.studio.generationState.failed": "Generation failed",
      "ContentV2.studio.historyStatus.failed": "Failed",
      "ContentV2.studio.postCard.postLabel": "Post {position}",
      "ContentV2.studio.postCard.state.planned": "Planned",
      "ContentV2.setup.title": "Content setup",
      "ContentV2.setup.backToStudio": "Back to studio",
      "ContentV2.setup.preferencesTitle": "Content preferences",
      "ContentV2.setup.advancedLabel": "Advanced preferences",
      "ContentV2.setup.audienceNuancePlaceholder": "Audience nuance",
      "ContentV2.errors.loadFailed": "Failed to load the studio.",
      "ContentV2.errors.legacyCycle": "Legacy cycle.",
      "ContentV2.errors.planInvalid":
        "This week's plan is no longer valid. Review the post cards or re-plan, then try again.",
      "ContentV2.errors.refresh": "Refresh",
    };
    const fullKey = `${namespace}.${key}`;
    if (fullKey in map) return map[fullKey];
    return key;
  },
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
  }),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/content-v2");
vi.mock("@/lib/api/content-cycle");
vi.mock("@/lib/api/publishing", () => ({
  createIdempotencyKey: () => "key-1",
}));

const walletState = vi.hoisted(() => ({
  wallet: null as { balance: number } | null,
}));

vi.mock("@/features/billing/wallet-context", () => ({
  useWallet: () => ({
    wallet: walletState.wallet,
    loading: false,
    error: false,
    refresh: vi.fn(),
  }),
}));

function baseWorkspace(
  overrides: Partial<ContentCycleWorkspaceV2> = {},
): ContentCycleWorkspaceV2 {
  return {
    contract_version: "content-v2",
    cycle: {
      id: "cycle-1",
      contract_version: "content-v2",
      business_id: "biz-1",
      strategy_id: "strat-1",
      strategy_version: 1,
      strategy_decision_id: "decision-1",
      profile_version_id: "prof-1",
      status: "active",
      current_week_number: 1,
      next_generation_at: null,
      timezone: "Africa/Cairo",
      pause_reason: null,
      completed_at: null,
      created_at: "2026-08-08T00:00:00.000Z",
      updated_at: "2026-08-08T00:00:00.000Z",
    },
    editorial_profile: null,
    cta_library: [],
    media_library: [],
    current_week: {
      week_number: 1,
      week_start_date: "2026-08-03",
      goal: "Set up the page",
      generation_state: "not_started",
      week_plan: null,
      pack: null,
      next_generation_at: null,
      primary_action: "plan_week",
    },
    previous_weeks: [],
    next_week: null,
    why_this_week: {
      focus: "Set up the page",
      expected_outcome: "Ready accounts",
      measurement_check: "Checklist done",
      owner_advice: [],
      committed_channels: ["facebook"],
      formats: ["text_post"],
    },
    strategy: {
      strategy_id: "strat-1",
      strategy_version: 1,
      strategy_decision_id: "decision-1",
      plan_goal: "Set up the page",
      plan_language: "ar-EG",
    },
    view_full_strategy_route: "/strategy/strat-1/review",
    ...overrides,
  };
}

function draftPlanWorkspace(
  overrides: Partial<ContentCycleWorkspaceV2> = {},
): ContentCycleWorkspaceV2 {
  return baseWorkspace({
    editorial_profile: null,
    current_week: {
      week_number: 1,
      week_start_date: "2026-08-03",
      goal: "Set up the page",
      generation_state: "planned",
      week_plan: {
        id: "week-plan-1",
        status: "draft",
        post_plans: [
          {
            id: "post-1",
            contract_version: "content-v2",
            content_week_plan_id: "week-plan-1",
            position: 1,
            purpose: "Announce the page",
            intended_audience: "Current customers",
            channel: "facebook",
            format: "text_post",
            cta_library_entry_id: null,
            owner_instructions: null,
            visual_direction: null,
            selected_media_ids: [],
            plan_state: "planned",
            source: "planner",
            content_item_id: null,
            created_at: "2026-08-08T00:00:00.000Z",
            updated_at: "2026-08-08T00:00:00.000Z",
          },
        ],
      },
      pack: null,
      next_generation_at: null,
      primary_action: "generate",
    },
    ...overrides,
  });
}

describe("ContentV2Studio", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPush.mockClear();
    walletState.wallet = { balance: 215 };
  });

  it("shows a single plan action with a default-voice hint on a fresh cycle", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      baseWorkspace(),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    await waitFor(() => {
      expect(screen.getByText("Plan this week")).toBeDefined();
    });

    // Exactly one primary button, exactly one settings button — no duplicates.
    expect(
      screen.getAllByRole("button", { name: "Plan this week" }).length,
    ).toBe(1);
    expect(
      screen.getAllByRole("button", { name: "Editorial settings" }).length,
    ).toBe(1);
    expect(screen.getByText(/default voice/i)).toBeDefined();
    expect(screen.getByText(/3–5 post cards/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Re-plan" })).toBeNull();
  });

  it("guides the owner to the CTA library from the content entry", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      baseWorkspace(),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open CTA library" }),
    );

    expect(await screen.findByText("ctaSection")).toBeDefined();
  });

  it("keeps unsaved editorial setup values when returning to the studio", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      baseWorkspace(),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    await screen.findByRole("button", { name: "Editorial settings" });
    fireEvent.click(screen.getByRole("button", { name: "Editorial settings" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Advanced preferences/ }),
    );
    const audience = screen.getByPlaceholderText("Audience nuance");
    fireEvent.change(audience, { target: { value: "Nearby office workers" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to studio" }));

    fireEvent.click(screen.getByRole("button", { name: "Editorial settings" }));
    expect(
      (screen.getByPlaceholderText("Audience nuance") as HTMLTextAreaElement)
        .value,
    ).toBe("Nearby office workers");
  });

  it("surfaces generate as the single primary action and re-plan on a draft plan", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      draftPlanWorkspace(),
    );
    vi.mocked(contentV2Api.planWeekV2).mockResolvedValue({} as never);
    vi.mocked(contentCycleApi.generateContentWeek).mockResolvedValue(
      {} as never,
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    await waitFor(() => {
      expect(screen.getByText("Generate drafts")).toBeDefined();
    });

    expect(
      screen.getAllByRole("button", { name: "Generate drafts" }).length,
    ).toBe(1);
    const replan = screen.getByRole("button", { name: "Re-plan" });
    fireEvent.click(replan);

    await waitFor(() => {
      expect(contentV2Api.planWeekV2).toHaveBeenCalledWith("cycle-1", 1);
    });
  });

  it("sends the generate action through the POST API helper", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      draftPlanWorkspace(),
    );
    vi.mocked(contentCycleApi.generateContentWeek).mockResolvedValue(
      {} as never,
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    const generateButton = await screen.findByRole("button", {
      name: "Generate drafts",
    });
    fireEvent.click(generateButton);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className.split(/\s+/)).toContain("rtl:translate-x-1/2");
    expect(dialog.className.split(/\s+/)).toContain("ltr:-translate-x-1/2");
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm and generate" }),
    );

    await waitFor(() => {
      expect(contentCycleApi.generateContentWeek).toHaveBeenCalledWith(
        "cycle-1",
        1,
        expect.objectContaining({
          content_cycle_id: "cycle-1",
          week_number: 1,
          idempotency_key: "key-1",
        }),
      );
    });
  });

  it("shows the week point cost when generation is available", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      draftPlanWorkspace(),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    const generateButton = await screen.findByRole("button", {
      name: "Generate drafts",
    });
    expect((generateButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/This week will use 2 points/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables generation and shows a top-up warning when the balance is below the week cost", async () => {
    walletState.wallet = { balance: 1 };
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      draftPlanWorkspace(),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    const generateButton = await screen.findByRole("button", {
      name: "Generate drafts",
    });
    expect((generateButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toMatch(/Top up/i);
    expect(
      screen.getByRole("link", { name: "Top up points" }),
    ).toBeTruthy();
    fireEvent.click(generateButton);
    const confirmButton = await screen.findByRole("button", {
      name: "Confirm and generate",
    });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    expect(contentCycleApi.generateContentWeek).not.toHaveBeenCalled();
  });

  it("shows an actionable error when the API rejects the planned week", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      draftPlanWorkspace(),
    );
    vi.mocked(contentCycleApi.generateContentWeek).mockRejectedValue({
      status: 400,
      code: "CONTENT_SCHEMA_FAILURE",
      message: "Week context is unavailable.",
    });

    render(<ContentV2Studio cycleId="cycle-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Generate drafts" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm and generate" }),
    );

    expect(await screen.findByText(/plan is no longer valid/i)).toBeDefined();
    expect(screen.queryByText("generateFailed")).toBeNull();
  });

  it("offers an owner-authorized fresh generation after a terminal failure", async () => {
    const failedWorkspace = draftPlanWorkspace({
      current_week: {
        ...draftPlanWorkspace().current_week,
        generation_state: "failed",
        week_plan: {
          ...draftPlanWorkspace().current_week.week_plan!,
          status: "frozen",
        },
        pack: {
          id: "pack-failed",
          contract_version: "content-v2",
          content_cycle_id: "cycle-1",
          week_number: 1,
          week_plan_id: "week-plan-1",
          status: "failed",
          retry_eligible: false,
          business_id: "biz-1",
          strategy_id: "strat-1",
          strategy_version: 1,
          strategy_decision_id: "decision-1",
          profile_version_id: "prof-1",
          week_context_id: "ctx-1",
          weekly_claim_id: "claim-1",
          item_ids: [],
          created_at: "2026-08-08T00:00:00.000Z",
          updated_at: "2026-08-08T00:00:00.000Z",
        },
        primary_action: "regenerate",
      },
    });
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      failedWorkspace,
    );
    vi.mocked(contentV2Api.regenerateContentPackV2).mockResolvedValue({
      content_pack: failedWorkspace.current_week.pack!,
      status: "queued",
      correlation_id: "corr-owner-recovery",
    });

    render(<ContentV2Studio cycleId="cycle-1" />);

    expect(
      await screen.findByText("The drafts could not be created"),
    ).toBeDefined();
    expect(screen.getByText(/nothing was published/i)).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate fresh drafts" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm and generate" }),
    );

    await waitFor(() => {
      expect(contentV2Api.regenerateContentPackV2).toHaveBeenCalledWith(
        "pack-failed",
      );
    });
    expect(contentCycleApi.retryContentPack).not.toHaveBeenCalled();
  });

  it("offers a weekly retry for a retryable failed pack", async () => {
    const failedWorkspace = draftPlanWorkspace({
      current_week: {
        ...draftPlanWorkspace().current_week,
        generation_state: "failed",
        week_plan: {
          ...draftPlanWorkspace().current_week.week_plan!,
          status: "draft",
        },
        pack: {
          ...draftPlanWorkspace().current_week.pack!,
          id: "pack-retryable",
          status: "failed",
          retry_eligible: true,
        },
        primary_action: "retry",
      },
    });
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      failedWorkspace,
    );
    vi.mocked(contentCycleApi.retryContentPack).mockResolvedValue({
      content_pack: failedWorkspace.current_week.pack!,
      status: "queued",
      correlation_id: "corr-week-retry",
    } as never);

    render(<ContentV2Studio cycleId="cycle-1" />);

    const retryButton = await screen.findByRole("button", {
      name: "Retry this week's generation",
    });
    fireEvent.click(retryButton);
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm and generate" }),
    );

    await waitFor(() => {
      expect(contentCycleApi.retryContentPack).toHaveBeenCalledWith(
        "pack-retryable",
      );
    });
    expect(contentV2Api.regenerateContentPackV2).not.toHaveBeenCalled();
  });

  it("navigates to the pack review from the single review primary action", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      draftPlanWorkspace({
        current_week: {
          week_number: 1,
          week_start_date: "2026-08-03",
          goal: "Set up the page",
          generation_state: "ready",
          week_plan: {
            id: "week-plan-1",
            status: "frozen",
            post_plans: [],
          },
          pack: {
            id: "pack-1",
            contract_version: "content-v2",
            content_cycle_id: "cycle-1",
            week_number: 1,
            week_plan_id: "week-plan-1",
            status: "draft",
            retry_eligible: false,
            business_id: "biz-1",
            strategy_id: "strat-1",
            strategy_version: 1,
            strategy_decision_id: "decision-1",
            profile_version_id: "prof-1",
            week_context_id: "ctx-1",
            weekly_claim_id: "claim-1",
            item_ids: [],
            created_at: "2026-08-08T00:00:00.000Z",
            updated_at: "2026-08-08T00:00:00.000Z",
          },
          next_generation_at: null,
          primary_action: "review_pack",
        },
      }),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    await waitFor(() => {
      expect(screen.getByText("Review drafts")).toBeDefined();
    });

    // One review link only — no duplicated entry point.
    const reviewLinks = screen.getAllByRole("link", {
      name: "Review drafts",
    });
    expect(reviewLinks.length).toBe(1);
    expect(reviewLinks[0].getAttribute("href")).toBe("/content/packs/pack-1");
  });

  it("shows a completed week as approved instead of asking for draft review", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      draftPlanWorkspace({
        current_week: {
          week_number: 1,
          week_start_date: "2026-08-03",
          goal: "Set up the page",
          generation_state: "completed",
          week_plan: {
            id: "week-plan-1",
            status: "frozen",
            post_plans: [],
          },
          pack: {
            id: "pack-1",
            contract_version: "content-v2",
            content_cycle_id: "cycle-1",
            week_number: 1,
            week_plan_id: "week-plan-1",
            status: "approved",
            retry_eligible: false,
            business_id: "biz-1",
            strategy_id: "strat-1",
            strategy_version: 1,
            strategy_decision_id: "decision-1",
            profile_version_id: "prof-1",
            week_context_id: "ctx-1",
            weekly_claim_id: "claim-1",
            item_ids: ["item-1"],
            created_at: "2026-08-08T00:00:00.000Z",
            updated_at: "2026-08-08T00:00:00.000Z",
          },
          next_generation_at: null,
          primary_action: "review_pack",
        },
      }),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    expect(
      await screen.findByText("All posts for this week are approved."),
    ).toBeDefined();
    const approvedLinks = screen.getAllByRole("link", {
      name: "View approved posts",
    });
    expect(approvedLinks).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Review drafts" })).toBeNull();
  });

  it("does not make a failed historical week look reviewable", async () => {
    vi.mocked(contentV2Api.getCycleWorkspaceV2).mockResolvedValue(
      baseWorkspace({
        previous_weeks: [
          {
            week_number: 1,
            week_start_date: "2026-07-27",
            status: "failed",
            plan_id: "week-plan-1",
            pack_id: "pack-failed",
            publication_candidate_created: false,
          },
        ],
      }),
    );

    render(<ContentV2Studio cycleId="cycle-1" />);

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeDefined();
    });
    expect(screen.queryByRole("link", { name: /Week 1/ })).toBeNull();
  });
});
