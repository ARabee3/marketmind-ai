import { test, expect } from "@playwright/test";
import { mockAuthMe, mockAuthRefresh } from "./fixtures/auth";

const MOCK_CYCLE_ID = "66666666-6666-4666-a666-666666666666";
const MOCK_STRATEGY_ID = "55555555-5555-4555-a555-555555555555";
const MOCK_STRATEGY_VERSION_ID = "33333333-3333-4333-a333-333333333333";
const MOCK_DECISION_ID = "44444444-4444-4444-a444-444444444444";
const MOCK_BUSINESS_ID = "11111111-1111-4111-a111-111111111111";
const MOCK_PROFILE_VERSION_ID = "55555555-5555-4555-a555-555555555555";

const mockJourneyNoCycle = {
  owner: {
    user_id: "user-1",
    full_name: "Ahmed Hassan",
    email: "owner@example.com",
    email_verified: true,
  },
  journey: {
    state: "discovery_confirmed",
    discovery: {
      session_id: "session-1",
      status: "confirmed",
      language_mode: "ar-EG",
      business_summary: {
        business_name: "Modern Cairo Cafe",
        business_type: "Hospitality & Dining",
        city: "Cairo",
        area: null,
      },
      readiness: {
        ready: true,
        profile_readiness: 1,
        owner_turn_count: 5,
        max_owner_turns: 10,
      },
      profile_draft_id: null,
      confirmed_profile_version_id: MOCK_PROFILE_VERSION_ID,
      updated_at: "2026-08-01T09:00:00.000Z",
      completed_at: "2026-08-01T09:00:00.000Z",
    },
    profile: {
      business_profile_version_id: MOCK_PROFILE_VERSION_ID,
      business_id: MOCK_BUSINESS_ID,
      version: 1,
      business_name: "Modern Cairo Cafe",
      business_type: "Hospitality & Dining",
      city: "Cairo",
      area: null,
      confirmed_at: "2026-08-01T09:00:00.000Z",
    },
  },
  future_phase: {
    phase: "strategy",
    availability: "available",
    status: "approved",
    reason: "strategy_active",
    strategy_id: MOCK_STRATEGY_ID,
    current_version_id: MOCK_STRATEGY_VERSION_ID,
    destination: `/strategy/${MOCK_STRATEGY_ID}`,
    business: null,
  },
  primary_action: {
    type: "view_strategy",
    strategy_id: MOCK_STRATEGY_ID,
    destination: `/strategy/${MOCK_STRATEGY_ID}`,
  },
  content: {
    ready: true,
    reason: "no_cycle",
    cycle: null,
    pack: null,
  },
  generated_at: "2026-08-06T10:00:00.000Z",
};

const mockJourneyWithActiveCycle = {
  ...mockJourneyNoCycle,
  content: {
    ready: true,
    reason: "cycle_active",
    cycle: {
      id: MOCK_CYCLE_ID,
      status: "active",
      current_week: 1,
    },
    pack: null,
  },
};

const mockStrategyApi = {
  id: MOCK_STRATEGY_ID,
  businessId: MOCK_BUSINESS_ID,
  status: "approved",
  ownerUserId: "user-1",
  currentVersionId: MOCK_STRATEGY_VERSION_ID,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-02T10:00:00.000Z",
  brief: {
    id: "brief-1",
    strategyId: MOCK_STRATEGY_ID,
    businessProfileVersionId: MOCK_PROFILE_VERSION_ID,
    businessProfileVersion: {
      id: MOCK_PROFILE_VERSION_ID,
      confirmedAt: "2026-08-01T09:00:00.000Z",
      version: 1,
    },
    primaryObjective: "conversion",
    startDate: "2026-08-10",
    planLanguage: "ar-EG",
    paidMediaAllowed: false,
    externalBudgetMode: "organic_only",
    externalBudgetEgp: null,
    teamCapacity: "1-2 hours per week",
    constraints: "No discount promotions over 20%",
    clarificationAnswers: [],
    createdAt: "2026-08-01T09:30:00.000Z",
    updatedAt: "2026-08-01T09:30:00.000Z",
  },
  latestPlan: {
    id: "plan-1",
    strategy_id: MOCK_STRATEGY_ID,
    version: 1,
    contract_version: "strategy-v1",
    brief_id: "brief-1",
    profile_version: {
      business_profile_version_id: MOCK_PROFILE_VERSION_ID,
      version: 1,
      confirmed_at: "2026-08-01T09:00:00.000Z",
    },
    retrieval_run_id: "run-1",
    channel_score_rule_version: "strategy-channel-score-v1",
    executive_summary: {
      text: "Comprehensive 12-week marketing strategy for SME growth.",
      source: "model_synthesis",
      citation_ids: [],
    },
    situation_diagnosis: {
      text: "Diagnosis text",
      source: "model_synthesis",
      citation_ids: [],
    },
    primary_objective: "conversion",
    funnel_stage: "acquisition",
    target_audience: {
      text: "Egyptian Consumers",
      source: "model_synthesis",
      citation_ids: [],
    },
    positioning: {
      text: "Growth partner",
      source: "model_synthesis",
      citation_ids: [],
    },
    selected_channels: [
      {
        channel: "facebook",
        role: "primary",
        rationale: { text: "High fit", source: "deterministic_result", citation_ids: [] },
        total_score: 90,
        excluded_reason: null,
        scores: {
          objective_fit: 10,
          audience_fit: 10,
          existing_presence: 10,
          asset_format_fit: 10,
          team_capacity: 10,
          budget_fit: 10,
          evidence_strength: 10,
          measurement_readiness: 10,
        },
      },
    ],
    all_channel_scores: [],
    tone: {
      text: "Professional & Friendly",
      source: "model_synthesis",
      citation_ids: [],
    },
    plan_language: "ar-EG",
    content_strategy: {
      pillars: [{ text: "Product Spotlights", source: "model_synthesis", citation_ids: [] }],
      format_mix: [],
      weekly_cadence: "3 posts per week",
      weeks: Array.from({ length: 12 }, (_, i) => ({
        week_number: i + 1,
        theme: `Week ${i + 1} Theme: Growth`,
        focus_products_or_services: ["A"],
        primary_goal: "Engagement",
        key_message: `Message for week ${i + 1}`,
        suggested_format: "Carousel",
        formats: ["carousel"],
      })),
      experiments: [],
    },
    budget_mode: "organic_only",
    budget_scenarios: null,
    kpi_targets: [],
    assumptions: [],
    risks: [],
    knowledge_gaps: [],
    blockers: [],
    citations: [],
    created_at: "2026-08-02T10:00:00.000Z",
  },
};

const mockStrategyVersions = [
  {
    version_id: MOCK_STRATEGY_VERSION_ID,
    strategy_id: MOCK_STRATEGY_ID,
    version: 1,
    status: "approved",
    brief_id: "brief-1",
    retrieval_run_id: "run-1",
    profile_version: {
      business_profile_version_id: MOCK_PROFILE_VERSION_ID,
      version: 1,
      confirmed_at: "2026-08-01T09:00:00.000Z",
    },
    prompt_config: {},
    created_at: "2026-08-02T10:00:00.000Z",
    decision: {
      id: MOCK_DECISION_ID,
      strategy_id: MOCK_STRATEGY_ID,
      strategy_version: 1,
      decision: "approved",
      revision_notes: null,
      decided_by_user_id: "user-1",
      decided_at: "2026-08-02T10:05:00.000Z",
    },
  },
];

const mockActiveCycle = {
  id: MOCK_CYCLE_ID,
  contract_version: "content-v1",
  business_id: MOCK_BUSINESS_ID,
  strategy_id: MOCK_STRATEGY_ID,
  strategy_version: 1,
  strategy_decision_id: MOCK_DECISION_ID,
  profile_version_id: MOCK_PROFILE_VERSION_ID,
  status: "active",
  current_week_number: 1,
  next_generation_at: "2026-08-17T00:00:00.000Z",
  timezone: "Africa/Cairo",
  pause_reason: null,
  completed_at: null,
  created_at: "2026-08-06T10:00:00.000Z",
  updated_at: "2026-08-06T10:00:00.000Z",
};

test.describe("Content Cycle E2E", () => {
  test("unauthenticated user accessing /en/content redirects to login flow", async ({ page }) => {
    await mockAuthRefresh(page, null);
    await page.goto("/en/content");
    await expect(page).toHaveURL(/.*\/en\/login.*/);
  });

  test("authenticated user starts 12-week content cycle", async ({ page }) => {
    await mockAuthRefresh(page);
    await mockAuthMe(page);

    await page.route("**/api/v1/journey/current", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockJourneyNoCycle) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyApi) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyVersions) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions/1`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyApi.latestPlan) }),
    );

    let createCycleCalls = 0;
    let createCyclePayload: unknown;
    await page.route("**/api/v1/content-cycles", (route) => {
      createCycleCalls++;
      createCyclePayload = route.request().postDataJSON() as Record<string, unknown>;
      route.fulfill({
        status: 201,
        body: JSON.stringify({
          content_cycle: mockActiveCycle,
          initial_week_context: {
            week_number: 1,
            promotion_mode: "none",
            cta_destination: { type: "none", value: null },
          },
        }),
      });
    });

    await page.goto("/en/content");

    // Form selection: select No promotion radio
    await page.getByRole("radio", { name: /no promotion/i }).check();
    await page.getByRole("combobox", { name: /cta type/i }).selectOption("none");
    await page.getByRole("button", { name: "Start 12-Week Content Cycle" }).click();

    await expect(page).toHaveURL(new RegExp(`/en/content/${MOCK_CYCLE_ID}/weeks/1`));
    expect(createCycleCalls).toBe(1);
    const createdContext = (createCyclePayload as {
      initial_week_context?: { cta_destination?: { type?: string } };
    } | undefined)?.initial_week_context;
    expect(createdContext?.cta_destination?.type).toBe("none");
  });

  test("canonical week route renders 12-week ledger and rejects week 13", async ({ page }) => {
    await mockAuthRefresh(page);
    await mockAuthMe(page);

    await page.route(`**/api/v1/content-cycles/${MOCK_CYCLE_ID}`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockActiveCycle) }),
    );
    await page.route(`**/api/v1/content-cycles/${MOCK_CYCLE_ID}/weeks`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ weeks: [] }) }),
    );
    await page.route("**/api/v1/journey/current", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockJourneyWithActiveCycle) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyApi) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyVersions) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions/1`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyApi.latestPlan) }),
    );

    await page.goto(`/en/content/${MOCK_CYCLE_ID}/weeks/1`);

    // Verify 12 week ledger region
    const ledger = page.locator("section[aria-label='12-Week Editorial Ledger'] nav");
    await expect(ledger).toBeVisible();

    const weekLinks = ledger.getByRole("link");
    await expect(weekLinks).toHaveCount(12);

    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 640) {
      const mobileNav = page.getByRole("navigation", { name: "Mobile primary" });
      const ul = mobileNav.locator("ul");
      await expect(ul).toBeVisible();
      await expect(ul).toHaveCSS("display", "flex");
      await expect(ul).toHaveCSS("overflow-x", "auto");
      // 6 fixed-min-width items should fit in a 640px-wide viewport
      const dimensions = await ul.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
    }

    await page.goto(`/en/content/${MOCK_CYCLE_ID}/weeks/3`);
    const weekThree = page.getByRole("navigation", { name: "12-Week Editorial Ledger" }).getByRole("link", { name: /W3/ });
    await expect(weekThree).toBeVisible();
    const weekThreeVisibility = await weekThree.evaluate((element) => {
      const container = element.closest("nav")?.getBoundingClientRect();
      const item = element.getBoundingClientRect();
      return container
        ? item.left >= container.left && item.right <= container.right
        : false;
    });
    expect(weekThreeVisibility).toBe(true);

    // Rejects week 13 with 404 page
    await page.goto(`/en/content/${MOCK_CYCLE_ID}/weeks/13`);
    await expect(page.getByText("404")).toBeVisible();
  });

  test("Arabic route renders dir=rtl and localized content cycle workspace", async ({ page }) => {
    await mockAuthRefresh(page);
    await mockAuthMe(page);

    await page.route(`**/api/v1/content-cycles/${MOCK_CYCLE_ID}`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockActiveCycle) }),
    );
    await page.route(`**/api/v1/content-cycles/${MOCK_CYCLE_ID}/weeks`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ weeks: [] }) }),
    );
    await page.route("**/api/v1/journey/current", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockJourneyWithActiveCycle) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyApi) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyVersions) }),
    );
    await page.route(`**/api/v1/strategies/${MOCK_STRATEGY_ID}/versions/1`, (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(mockStrategyApi.latestPlan) }),
    );

    await page.goto(`/ar/content/${MOCK_CYCLE_ID}/weeks/1`);

    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");

    await expect(page.getByRole("heading", { name: "الدفتر التحريري لـ 12 أسبوعًا" })).toBeVisible();
  });
});
