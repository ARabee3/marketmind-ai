import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  ContentCycleWorkspaceV2,
  ContentPostPlanV2,
  CurrentJourneyResponse,
} from "@marketmind/contracts";
import {
  mockActiveCycle,
  mockApprovedStrategyApiV2,
  mockJourneyNoCycle,
  mockStrategyVersions,
  MOCK_CYCLE_ID,
  MOCK_DECISION_ID,
  MOCK_PACK_ID,
  MOCK_STRATEGY_ID,
} from "../src/features/content/cycle/lib/content-cycle-fixtures";
import { mockAuthMe, mockAuthRefresh } from "./fixtures/auth";

const mockCycleV2 = {
  ...mockActiveCycle,
  contract_version: "content-v2" as const,
};

const mockPlan: ContentPostPlanV2 = {
  id: "post-plan-1",
  contract_version: "content-v2",
  content_week_plan_id: "week-plan-1",
  position: 1,
  purpose: "Introduce the business clearly",
  intended_audience: "Nearby customers",
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
};

function workspace(
  overrides: Partial<ContentCycleWorkspaceV2> = {},
): ContentCycleWorkspaceV2 {
  return {
    contract_version: "content-v2",
    cycle: mockCycleV2,
    editorial_profile: null,
    cta_library: [],
    media_library: [],
    current_week: {
      week_number: 1,
      week_start_date: "2026-08-10",
      goal: "Build a clear first week of presence",
      generation_state: "not_started",
      week_plan: null,
      pack: null,
      next_generation_at: null,
      primary_action: "plan_week",
    },
    previous_weeks: [],
    next_week: {
      week_number: 2,
      week_start_date: "2026-08-17",
      status: "not_started",
      plan_id: null,
      pack_id: null,
      publication_candidate_created: false,
    },
    why_this_week: {
      focus: "Build a clear first week of presence",
      expected_outcome: "A consistent first set of posts",
      measurement_check: "Owner review complete",
      owner_advice: [],
      committed_channels: ["facebook"],
      formats: ["text_post"],
    },
    strategy: {
      strategy_id: MOCK_STRATEGY_ID,
      strategy_version: 1,
      strategy_decision_id: MOCK_DECISION_ID,
      plan_goal: "Build a clear first week of presence",
      plan_language: "ar-EG",
    },
    view_full_strategy_route: `/strategy/${MOCK_STRATEGY_ID}/review`,
    ...overrides,
  };
}

function plannedWorkspace(): ContentCycleWorkspaceV2 {
  return workspace({
    current_week: {
      week_number: 1,
      week_start_date: "2026-08-10",
      goal: "Build a clear first week of presence",
      generation_state: "planned",
      week_plan: {
        id: "week-plan-1",
        status: "draft",
        post_plans: [mockPlan],
      },
      pack: null,
      next_generation_at: null,
      primary_action: "generate",
    },
  });
}

function reviewableWorkspace(): ContentCycleWorkspaceV2 {
  return workspace({
    current_week: {
      week_number: 1,
      week_start_date: "2026-08-10",
      goal: "Build a clear first week of presence",
      generation_state: "ready",
      week_plan: {
        id: "week-plan-1",
        status: "frozen",
        post_plans: [],
      },
      pack: {
        id: MOCK_PACK_ID,
        contract_version: "content-v2",
        content_cycle_id: MOCK_CYCLE_ID,
        weekly_claim_id: "claim-1",
        week_number: 1,
        business_id: mockCycleV2.business_id,
        strategy_id: MOCK_STRATEGY_ID,
        strategy_version: 1,
        strategy_decision_id: MOCK_DECISION_ID,
        profile_version_id: mockCycleV2.profile_version_id,
        week_context_id: "context-1",
        status: "draft",
        retry_eligible: false,
        item_ids: [],
        week_plan_id: "week-plan-1",
        created_at: "2026-08-08T00:00:00.000Z",
        updated_at: "2026-08-08T00:00:00.000Z",
      },
      next_generation_at: null,
      primary_action: "review_pack",
    },
  });
}

function failedWorkspace(): ContentCycleWorkspaceV2 {
  return workspace({
    current_week: {
      week_number: 1,
      week_start_date: "2026-08-10",
      goal: "Build a clear first week of presence",
      generation_state: "failed",
      week_plan: {
        id: "week-plan-1",
        status: "frozen",
        post_plans: [{ ...mockPlan, plan_state: "failed" }],
      },
      pack: {
        id: MOCK_PACK_ID,
        contract_version: "content-v2",
        content_cycle_id: MOCK_CYCLE_ID,
        weekly_claim_id: "claim-1",
        week_number: 1,
        business_id: mockCycleV2.business_id,
        strategy_id: MOCK_STRATEGY_ID,
        strategy_version: 1,
        strategy_decision_id: MOCK_DECISION_ID,
        profile_version_id: mockCycleV2.profile_version_id,
        week_context_id: "context-1",
        status: "failed",
        retry_eligible: false,
        item_ids: [],
        week_plan_id: "week-plan-1",
        created_at: "2026-08-08T00:00:00.000Z",
        updated_at: "2026-08-08T00:00:00.000Z",
      },
      next_generation_at: null,
      primary_action: "regenerate",
    },
  });
}

async function authenticate(page: Page) {
  await mockAuthRefresh(page);
  await mockAuthMe(page);
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockApprovedEntry(page: Page) {
  const journey = {
    ...mockJourneyNoCycle,
    journey: {
      ...mockJourneyNoCycle.journey,
      strategy: { id: MOCK_STRATEGY_ID, status: "approved" },
      strategy_decision: {
        decision: "approved",
        decision_id: MOCK_DECISION_ID,
        approved_version_id: mockStrategyVersions[0].version_id,
      },
    },
  } as unknown as CurrentJourneyResponse;

  await page.route("**/api/v1/journey/current", (route) =>
    json(route, journey),
  );
  await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}`, (route) =>
    json(route, mockApprovedStrategyApiV2),
  );
  await page.route(
    `**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions`,
    (route) => json(route, mockStrategyVersions),
  );
  await page.route(
    `**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions/1`,
    (route) => json(route, mockApprovedStrategyApiV2.latestPlan),
  );
}

async function mockStudio(
  page: Page,
  value: ContentCycleWorkspaceV2,
  onPlan?: (route: Route) => Promise<void>,
) {
  await page.route(
    `**/api/v1/content-cycles/${MOCK_CYCLE_ID}/workspace`,
    (route) => json(route, value),
  );
  if (onPlan) {
    await page.route(
      `**/api/v1/content-cycles/${MOCK_CYCLE_ID}/weeks/1/plan`,
      onPlan,
    );
  }
}

test.describe("Content V2 weekly studio", () => {
  test("unauthenticated user accessing /en/content redirects to login", async ({
    page,
  }) => {
    await mockAuthRefresh(page, null);
    await page.goto("/en/content");
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("starts a V2 cycle with a safe default and lands in the studio", async ({
    page,
  }) => {
    await authenticate(page);
    await mockApprovedEntry(page);

    let createCalls = 0;
    let createPayload: Record<string, unknown> | null = null;
    await page.route("**/api/v1/content-cycles", async (route) => {
      createCalls += 1;
      createPayload = route.request().postDataJSON() as Record<string, unknown>;
      await json(
        route,
        {
          content_cycle: mockCycleV2,
          initial_week_context: {},
        },
        201,
      );
    });
    await mockStudio(page, workspace());

    await page.goto("/en/content");
    await page
      .getByRole("button", { name: /Start 12-week content cycle/i })
      .click();

    await expect(page).toHaveURL(`/en/content/${MOCK_CYCLE_ID}/studio`);
    expect(createCalls).toBe(1);
    const initialWeekContext = (
      createPayload as unknown as {
        initial_week_context?: { promotion_mode?: string };
      }
    ).initial_week_context;
    expect(initialWeekContext?.promotion_mode).toBe("none");
    await expect(
      page.getByRole("button", { name: "Plan this week" }),
    ).toBeVisible();
  });

  test("double-clicking start still creates one cycle", async ({ page }) => {
    await authenticate(page);
    await mockApprovedEntry(page);
    let createCalls = 0;
    await page.route("**/api/v1/content-cycles", async (route) => {
      createCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      await json(
        route,
        { content_cycle: mockCycleV2, initial_week_context: {} },
        201,
      );
    });
    await mockStudio(page, workspace());

    await page.goto("/en/content");
    await page
      .getByRole("button", { name: /Start 12-week content cycle/i })
      .dblclick();
    await expect(page).toHaveURL(`/en/content/${MOCK_CYCLE_ID}/studio`);
    expect(createCalls).toBe(1);
  });

  test("fresh studio has one plan action, neutral defaults, and the weekly context", async ({
    page,
  }) => {
    await authenticate(page);
    await mockStudio(page, workspace());
    await page.goto(`/en/content/${MOCK_CYCLE_ID}/studio`);

    await expect(
      page.getByRole("button", { name: "Plan this week" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Editorial settings" }),
    ).toHaveCount(1);
    await expect(page.getByText(/default voice/i)).toBeVisible();
    await expect(page.getByText(/3–5 post cards/i)).toBeVisible();
    await expect(page.getByText("Why this week?")).toBeVisible();
    await expect(page.getByText("Week 2: Not started")).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-plan" })).toHaveCount(0);
  });

  test("planned studio exposes Generate drafts as primary and Re-plan as secondary", async ({
    page,
  }) => {
    await authenticate(page);
    let generateCalls = 0;
    await mockStudio(page, plannedWorkspace());
    await page.route(
      `**/api/v1/content-cycles/${MOCK_CYCLE_ID}/weeks/1/generate`,
      async (route) => {
        generateCalls += 1;
        expect(route.request().method()).toBe("POST");
        await json(route, { status: "queued", content_pack: {} });
      },
    );

    await page.goto(`/en/content/${MOCK_CYCLE_ID}/studio`);
    await expect(
      page.getByRole("button", { name: "Generate drafts" }),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Re-plan" })).toHaveCount(1);
    await page.getByRole("button", { name: "Generate drafts" }).click();
    await page
      .getByRole("button", { name: "Confirm and generate" })
      .click();
    await expect.poll(() => generateCalls).toBe(1);
  });

  test("reviewable studio has one working review entry point", async ({
    page,
  }) => {
    await authenticate(page);
    await mockStudio(page, reviewableWorkspace());
    await page.goto(`/en/content/${MOCK_CYCLE_ID}/studio`);
    const review = page.getByRole("link", { name: "Review drafts" });
    await expect(review).toHaveCount(1);
    await expect(review).toHaveAttribute(
      "href",
      `/en/content/packs/${MOCK_PACK_ID}`,
    );
  });

  test("terminal generation failure offers one owner-authorized fresh attempt", async ({
    page,
  }) => {
    await authenticate(page);
    await mockStudio(page, failedWorkspace());
    let regenerationCalls = 0;
    await page.route(
      `**/api/v1/content-packs/${MOCK_PACK_ID}/regenerate`,
      async (route) => {
        regenerationCalls += 1;
        expect(route.request().method()).toBe("POST");
        await json(route, {
          content_pack: failedWorkspace().current_week.pack,
          status: "queued",
          correlation_id: "owner-recovery-1",
        });
      },
    );

    await page.goto(`/en/content/${MOCK_CYCLE_ID}/studio`);
    await expect(
      page.getByRole("heading", { name: "The drafts could not be created" }),
    ).toBeVisible();
    await expect(page.getByText(/nothing was published/i)).toBeVisible();
    const regenerate = page.getByRole("button", {
      name: "Generate fresh drafts",
    });
    await expect(regenerate).toHaveCount(1);
    await regenerate.click();
    await page
      .getByRole("button", { name: "Confirm and generate" })
      .click();
    await expect.poll(() => regenerationCalls).toBe(1);
  });

  test("the retired week URL redirects a V2 cycle to studio", async ({
    page,
  }) => {
    await authenticate(page);
    await page.route(`**/api/v1/content-cycles/${MOCK_CYCLE_ID}`, (route) =>
      json(route, mockCycleV2),
    );
    await mockStudio(page, workspace());
    await page.goto(`/en/content/${MOCK_CYCLE_ID}/weeks/1`);
    await expect(page).toHaveURL(`/en/content/${MOCK_CYCLE_ID}/studio`);
  });

  test("Arabic studio keeps RTL and the same single-action contract", async ({
    page,
  }) => {
    await authenticate(page);
    await mockStudio(page, workspace());
    await page.goto(`/ar/content/${MOCK_CYCLE_ID}/studio`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("button", { name: /خطّط هذا الأسبوع/ }),
    ).toHaveCount(1);
  });

  test("Arabic recovery remains readable without mobile overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await authenticate(page);
    await mockStudio(page, failedWorkspace());
    await page.goto(`/ar/content/${MOCK_CYCLE_ID}/studio`);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: "تعذّر إنشاء المسودات" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "أنشئ مسودات جديدة" }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
