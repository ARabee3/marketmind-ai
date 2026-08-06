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
const exportChecksum =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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

test.describe("Suite G: bilingual state and recovery mapping", () => {
  test("G1 renders the awaiting-approval flow in Arabic with RTL direction", async ({
    page,
  }) => {
    await authenticate(page);
    await mockPublishingApi(
      page,
      makeState({
        intent: { ...PUBLISHING_INTENT_FIXTURE, state: "awaiting_approval" },
      }),
    );

    await page.goto(`/ar/publishing/${intentId}/review`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: "الأسبوع 2", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("مراجعة الاعتماد الكامل")).toBeVisible();

    await page.getByRole("button", { name: "اعتماد وجدولة" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "اعتماد النشر الكامل؟" }),
    ).toBeVisible();
    await expect(
      page.getByText("الاعتماد ممكن يسمح بمنشور خارجي."),
    ).toBeVisible();
  });

  test("G2 surfaces a retryable provider failure in English with the Retry CTA", async ({
    page,
  }) => {
    await authenticate(page);
    await mockPublishingApi(
      page,
      makeState({
        intent: { ...PUBLISHING_INTENT_FIXTURE, state: "failed" },
        attempts: [failedAttempt("attempt-f", "PUBLISHING_PROVIDER_REJECTED")],
        results: [
          failedResult("attempt-f", "PUBLISHING_PROVIDER_REJECTED", true),
        ],
      }),
    );

    await page.goto(`/en/publishing/${intentId}/review`);
    await expect(
      page.getByRole("heading", { name: "Publication failed" }),
    ).toBeVisible();
    await expect(page.getByText("PUBLISHING_PROVIDER_REJECTED")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry proven failure" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve and schedule" }),
    ).toHaveCount(0);
  });

  test("G3 shows the reconciliation banner for an unknown provider outcome and never offers retry", async ({
    page,
  }) => {
    await authenticate(page);
    await mockPublishingApi(
      page,
      makeState({
        intent: { ...PUBLISHING_INTENT_FIXTURE, state: "action_required" },
        attempts: [failedAttempt("attempt-u", null, "unknown")],
        results: [failedResult("attempt-u", null, false, "UNKNOWN")],
      }),
    );

    await page.goto(`/en/publishing/${intentId}/review`);
    await expect(
      page.getByText("Do not repost or retry.").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry proven failure" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Refresh status" }),
    ).toBeVisible();
  });

  test("G5 renders the exported outcome with the archive checksum and downloads the archive", async ({
    page,
  }) => {
    const state = makeState({
      intent: {
        ...PUBLISHING_INTENT_FIXTURE,
        mode: "manual_export",
        state: "succeeded",
      },
      results: [
        {
          id: "result-export-1",
          attempt_id: "attempt-export-1",
          intent_id: intentId,
          intent_version: 2,
          mode: "MANUAL_EXPORT",
          outcome: "EXPORTED",
          error_code: null,
          retryable: false,
          occurred_at: "2026-08-04T12:00:00Z",
        },
      ],
      exportState: {
        id: "metadata-1",
        artifactId: "artifact-export-1",
        checksum: exportChecksum,
        exportType: "manual_archive_targz",
        status: "ready",
        downloadUrl: `/publication-intents/${intentId}/export/download`,
        exportedAt: "2026-08-05T10:00:00Z",
        manifest: {
          contract_version: "publication-export-manifest-v1",
          artifact_id: "artifact-export-1",
          candidate_id: "dededede-dede-4ded-8ded-dededededede",
          candidate_checksum: PUBLISHING_INTENT_FIXTURE.candidate_checksum,
          content_item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          content_item_version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          content_item_version: 2,
          target_channel: "facebook",
          content_format: "static_image_post",
          selected_locale: "ar",
          generated_at: "2026-08-05T10:00:00Z",
          label: "EXPORTED_NOT_PUBLISHED",
          assets: [
            {
              asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              checksum: "dummy-asset-checksum",
              archive_path: "assets/post.png",
            },
          ],
        },
      },
    });
    await authenticate(page);
    await mockPublishingApi(page, state);

    await page.goto(`/en/publishing/${intentId}/review`);
    await expect(
      page.getByRole("heading", { name: "Exported — not published" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download archive" }),
    ).toBeVisible();

    await page.locator("summary").filter({ hasText: "Archive manifest" }).click();
    await expect(page.getByText(exportChecksum)).toBeVisible();

    await page.getByRole("button", { name: "Download archive" }).click();
    await expect(
      page.getByText("The archive could not be downloaded."),
    ).toHaveCount(0);
    await expect.poll(() => state.downloadsRequested).toBe(1);
  });

  test("G6 keeps the recovery shell usable in Arabic on mobile with RTL direction", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "The bottom nav is intentionally hidden on desktop.",
    );
    await authenticate(page);
    await mockPublishingApi(
      page,
      makeState({
        intent: { ...PUBLISHING_INTENT_FIXTURE, state: "action_required" },
        attempts: [failedAttempt("attempt-m", null, "unknown")],
        results: [failedResult("attempt-m", null, false, "UNKNOWN")],
      }),
    );

    await page.goto(`/ar/publishing/${intentId}/review`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const nav = page.getByRole("navigation", { name: "أساسي للجوال" });
    await expect(nav).toHaveClass(/fixed/);
    await expect(nav).toHaveClass(/bottom-0/);
    await expect(
      page.getByText("متحاولش تنشر أو تعيد المحاولة.").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "تحديث الحالة" }),
    ).toBeVisible();
  });

  test("G8 renders a cancelled intent as read-only with no approve or retry actions", async ({
    page,
  }) => {
    await authenticate(page);
    await mockPublishingApi(
      page,
      makeState({
        intent: { ...PUBLISHING_INTENT_FIXTURE, state: "cancelled" },
      }),
    );

    await page.goto(`/en/publishing/${intentId}/review`);
    await expect(
      page.getByLabel("Next safe action").getByText("Cancelled", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This intent is read-only. Start a new decision if the candidate is still active.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve and schedule" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Retry proven failure" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Cancel intent" }),
    ).toHaveCount(0);
  });

  test("G7 shows the Arabic load-error screen when a foreign tenant cannot read the intent", async ({
    page,
  }) => {
    await authenticate(page);
    const state = makeState();
    await mockPublishingApi(page, state);
    await page.route(
      /\/api\/v1\/publication-intents\/13131313-1313-4131-8131-131313131313$/,
      (route) => {
        if (route.request().method() === "GET") {
          void json(route, { code: "PUBLISHING_FORBIDDEN" }, 403);
          return;
        }
        void json(route, { code: "NOT_FOUND" }, 404);
      },
    );

    await page.goto(`/ar/publishing/${intentId}/review`);
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "تعذر تحميل النشر" });
    await expect(alert).toContainText("الشاشة دي ما نشرتش أي حاجة.");
    await expect(alert.getByRole("button", { name: "جرّب تاني" })).toBeVisible();
  });
});

function failedAttempt(
  attemptId: string,
  errorCode: string | null,
  state = "failed",
) {
  return {
    attempt_id: attemptId,
    intent_id: intentId,
    intent_version: 2,
    attempt_number: 1,
    idempotency_key: "idem-1",
    workflow_version: "publishing-dispatch-v1",
    request_fingerprint: "fp-1",
    state,
    error_code: errorCode,
    started_at: "2026-08-04T11:59:00Z",
    finished_at: "2026-08-04T12:00:00Z",
    created_at: "2026-08-04T11:59:00Z",
  };
}

function failedResult(
  attemptId: string,
  errorCode: string | null,
  retryable: boolean,
  outcome = "FAILED",
) {
  return {
    id: "result-1",
    attempt_id: attemptId,
    intent_id: intentId,
    intent_version: 2,
    mode: "REAL",
    outcome,
    error_code: errorCode,
    retryable,
    occurred_at: "2026-08-04T12:00:00Z",
  };
}

type MockState = {
  intent: PublicationIntentV1 | null;
  simulationDispatched: boolean;
  attempts: unknown[];
  results: unknown[];
  exportState: unknown | null;
  downloadsRequested: number;
};

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    intent: null,
    simulationDispatched: false,
    attempts: [],
    results: [],
    exportState: null,
    downloadsRequested: 0,
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
      attempts: state.attempts,
      results: state.simulationDispatched
        ? [simulationResult()]
        : state.results,
    });
    return;
  }
  if (
    path.endsWith(`/publication-intents/${intentId}/export`) &&
    request.method() === "GET"
  ) {
    await json(
      route,
      state.exportState ?? {
        exportType: "manual_archive_pending",
        artifactId: null,
      },
    );
    return;
  }
  if (
    path.endsWith(`/publication-intents/${intentId}/export/download`) &&
    request.method() === "GET"
  ) {
    state.downloadsRequested += 1;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="marketmind-export-${intentId}.zip"`,
        "x-publishing-export-checksum": exportChecksum,
      },
      body: Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00]),
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
