import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  CurrentJourneyResponse,
  PublicationIntentV1,
} from "@marketmind/contracts";
import {
  PUBLISHING_CANDIDATE_FIXTURES,
  PUBLISHING_INTENT_FIXTURE,
  PUBLISHING_JOURNEY_FIXTURE,
  PUBLISHING_TARGET_FIXTURES,
} from "../src/features/publishing/lib/publishing-fixtures";
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from "./fixtures/auth";

const intentId = "13131313-1313-4131-8131-131313131313";
const targetFixture = PUBLISHING_TARGET_FIXTURES[0];

test.describe("Publishing owner journey", () => {
  test("shows the immutable candidate and keeps simulation visibly separate from real publishing", async ({
    page,
  }) => {
    const state = makeState();
    await authenticate(page);
    await mockPublishingApi(page, state);

    await page.goto("/en/publishing");
    await expect(
      page.getByRole("heading", { name: "Publishing workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Exact content version" }),
    ).toBeVisible();
    await expect(
      page.getByText("Publishing cannot edit this item."),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /Real publishing/ }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("radio", { name: /Manual export/ }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("radio", { name: /Simulation/ }),
    ).not.toBeChecked();

    await page
      .getByRole("radio", { name: /Simulation/ })
      .check({ force: true });
    await page.getByRole("button", { name: "Run simulation" }).click();

    await expect(page).toHaveURL(new RegExp(`/en/publishing/${intentId}$`));
    await expect(
      page.getByText("SIMULATION — nothing was published"),
    ).toBeVisible();
    await expect(page.getByText("SIMULATION", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Publishing" }),
    ).toHaveAttribute("href", "/en/publishing");
  });

  test("opens the exact approval dialog for a real scheduled intent", async ({
    page,
  }) => {
    const state = makeState({
      intent: {
        ...PUBLISHING_INTENT_FIXTURE,
        intent_id: intentId,
        state: "awaiting_approval",
        scheduled_local: "2026-08-10T18:30:00",
        scheduled_utc: "2026-08-10T15:30:00Z",
      },
    });
    await authenticate(page);
    await mockPublishingApi(page, state);

    await page.goto(`/en/publishing/${intentId}/review`);
    await expect(
      page.getByRole("heading", { name: "Week 2", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Review exact approval")).toBeVisible();
    await page.getByRole("button", { name: "Approve and schedule" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Approve this exact publication?" }),
    ).toBeVisible();
    await expect(
      page.getByText("Approval can authorize an external post."),
    ).toBeVisible();
  });

  test("does not re-approve a scheduled intent and confirms cancellation", async ({
    page,
  }) => {
    await authenticate(page);
    await mockPublishingApi(
      page,
      makeState({ intent: PUBLISHING_INTENT_FIXTURE }),
    );

    await page.goto(`/en/publishing/${intentId}/review`);
    await expect(
      page.getByText(
        "This item is scheduled for the connected account shown above.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve and schedule" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Cancel intent" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Cancel this publishing intent?",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(PUBLISHING_INTENT_FIXTURE.candidate_id),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep intent" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("keeps the locale and restores a selected runway week from the URL", async ({
    page,
  }) => {
    await authenticate(page);
    await mockPublishingApi(page, makeState());

    await page.goto("/en/publishing?week=3");
    await expect(
      page.getByRole("heading", { name: "Week 3", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Week 2 / }).click();
    await expect(page).toHaveURL(
      /\/en\/publishing\?week=2&candidate=[0-9a-f-]+$/,
    );

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Week 2", exact: true }),
    ).toBeVisible();
  });

  test("renders the required fixed bottom navigation on mobile", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "The bottom nav is intentionally hidden on desktop.",
    );
    await authenticate(page);
    await mockPublishingApi(page, makeState());
    await page.goto("/en/publishing");
    const nav = page.getByRole("navigation", { name: "Mobile primary" });
    await expect(nav).toHaveClass(/fixed/);
    await expect(nav).toHaveClass(/bottom-0/);
    await expect(nav.getByRole("link", { name: "Publishing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

type MockState = {
  intent: PublicationIntentV1 | null;
  simulationDispatched: boolean;
};

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    intent: null,
    simulationDispatched: false,
    ...overrides,
  };
}

async function authenticate(page: Page) {
  await mockAuthRefresh(page, mockAccessToken);
  await mockAuthMe(page);
}

async function mockPublishingApi(page: Page, state: MockState) {
  const journey: CurrentJourneyResponse = {
    ...PUBLISHING_JOURNEY_FIXTURE,
    content: {
      ready: true,
      reason: "cycle_active",
      cycle: { ...PUBLISHING_JOURNEY_FIXTURE.content!.cycle!, current_week: 1 },
      pack: PUBLISHING_JOURNEY_FIXTURE.content!.pack,
    },
  };
  await page.route(
    /\/api\/v1\/(publication-candidates|publication-intents|publishing-targets|journey\/current|content-assets)/,
    async (route) => {
      await handlePublishingRoute(route, state, journey);
    },
  );
}

async function handlePublishingRoute(
  route: Route,
  state: MockState,
  journey: CurrentJourneyResponse,
) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;

  if (path.endsWith("/journey/current")) {
    await json(route, journey);
    return;
  }
  if (path.endsWith("/content-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")) {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ code: "NOT_FOUND" }),
    });
    return;
  }
  if (path.endsWith("/publication-candidates") && request.method() === "GET") {
    await json(
      route,
      PUBLISHING_CANDIDATE_FIXTURES.map((entry) => ({
        id: entry.candidate.candidate_id,
        payload: entry.candidate,
        status: entry.source_state.toUpperCase(),
        sourceStateVersion: entry.source_state_version,
        receivedAt: entry.received_at,
      })),
    );
    return;
  }
  if (path.endsWith("/publishing-targets") && request.method() === "GET") {
    await json(
      route,
      PUBLISHING_TARGET_FIXTURES.map((target) => ({
        id: target.target_id,
        version: target.version,
        businessId: target.business_id,
        provider: "META",
        channel: target.channel,
        externalAccountId: target.external_account_id,
        displayName: target.display_name,
        connectionState: target.connection_state.toUpperCase(),
        capabilities: target.capabilities,
        lastVerifiedAt: target.last_verified_at,
      })),
    );
    return;
  }
  if (path.endsWith("/publication-intents") && request.method() === "GET") {
    await json(route, state.intent ? [intentRow(state.intent)] : []);
    return;
  }
  if (path.endsWith("/publication-intents") && request.method() === "POST") {
    const body = (await request.postDataJSON()) as {
      candidateId: string;
      mode: string;
    };
    state.intent = {
      ...PUBLISHING_INTENT_FIXTURE,
      intent_id: intentId,
      candidate_id: body.candidateId,
      mode:
        body.mode === "SIMULATION"
          ? "simulation"
          : body.mode === "MANUAL_EXPORT"
            ? "manual_export"
            : "real",
      state: "draft",
      target_id: null,
      scheduled_local: null,
      scheduled_utc: null,
      approved_decision_id: null,
    };
    const createdIntent = state.intent;
    if (!createdIntent) throw new Error("Expected a created publishing intent");
    await json(route, { publicationIntent: intentRow(createdIntent) }, 201);
    return;
  }
  if (
    path.endsWith(`/publication-intents/${intentId}`) &&
    request.method() === "GET"
  ) {
    await json(route, detailRow(state.intent ?? PUBLISHING_INTENT_FIXTURE));
    return;
  }
  if (
    path.endsWith(`/publication-intents/${intentId}/attempts`) &&
    request.method() === "GET"
  ) {
    await json(route, {
      attempts: [],
      results: state.simulationDispatched ? [simulationResult()] : [],
    });
    return;
  }
  if (
    path.endsWith(`/publication-intents/${intentId}/export`) &&
    request.method() === "GET"
  ) {
    await json(route, {
      exportType: "manual_archive_pending",
      artifactId: null,
    });
    return;
  }
  if (
    path.endsWith(`/publication-intents/${intentId}/dispatch-simulation`) &&
    request.method() === "POST"
  ) {
    state.simulationDispatched = true;
    if (state.intent)
      state.intent = {
        ...state.intent,
        version: state.intent.version + 1,
        state: "succeeded",
      };
    await json(route, {
      intent: intentRow(state.intent ?? PUBLISHING_INTENT_FIXTURE),
    });
    return;
  }
  await json(route, { code: "NOT_FOUND" }, 404);
}

function intentRow(intent: PublicationIntentV1) {
  return {
    id: intent.intent_id,
    version: intent.version,
    businessId: intent.business_id,
    candidateId: intent.candidate_id,
    candidateChecksum: intent.candidate_checksum,
    mode: intent.mode.toUpperCase(),
    status: intent.state.toUpperCase(),
    targetId: intent.target_id,
    scheduledLocalAt: intent.scheduled_local,
    scheduledUtcAt: intent.scheduled_utc,
    timezone: intent.time_zone,
    approvedDecisionId: intent.approved_decision_id,
    createdByUserId: intent.created_by_user_id,
    createdAt: intent.created_at,
    updatedAt: intent.updated_at,
    target: intent.target_id ? PUBLISHING_TARGET_FIXTURES[0] : null,
  };
}

function detailRow(intent: PublicationIntentV1) {
  return {
    publicationIntent: intentRow(intent),
    target: intent.target_id
      ? {
          id: targetFixture.target_id,
          version: targetFixture.version,
          businessId: targetFixture.business_id,
          channel: targetFixture.channel,
          externalAccountId: targetFixture.external_account_id,
          displayName: targetFixture.display_name,
          connectionState: "CONNECTED",
          capabilities: ["static_image"],
          lastVerifiedAt: targetFixture.last_verified_at,
        }
      : null,
    approvals: intent.approved_decision_id
      ? [
          {
            id: intent.approved_decision_id,
            intentId: intent.intent_id,
            intentVersionAtDecision: intent.version,
            candidateId: intent.candidate_id,
            candidateChecksum: intent.candidate_checksum,
            targetId: targetFixture.target_id,
            scheduledLocalAt: intent.scheduled_local,
            timezone: "Africa/Cairo",
            scheduledUtcAt: intent.scheduled_utc,
            decision: "APPROVED",
            decidedByUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            decidedAt: "2026-08-02T12:00:00Z",
            approvalFingerprint: "fingerprint",
          },
        ]
      : [],
  };
}

function simulationResult() {
  return {
    id: "result-1",
    attemptId: "attempt-1",
    intentId,
    intentVersion: 3,
    mode: "SIMULATION",
    outcome: "SIMULATED",
    simulationReferenceId: "simulation-1",
    occurredAt: "2026-08-04T12:00:00Z",
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
