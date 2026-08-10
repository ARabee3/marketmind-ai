import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  ContentDecision,
  ContentItemVersionV2,
  ContentMediaLibraryEntryV2,
  ContentPackWorkspaceV2,
} from "@marketmind/contracts";
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from "./fixtures/auth";

const packId = "11111111-1111-4111-8111-111111111111";
const cycleId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const mediaId = "55555555-5555-4555-8555-555555555555";
const checksum = "a".repeat(64);

function makeVersion(): ContentItemVersionV2 {
  return {
    id: versionId,
    contract_version: "content-v2",
    content_item_id: itemId,
    content_pack_id: packId,
    version: 1,
    channel: "facebook",
    format: "static_image_post",
    language_mode: "ar-EG",
    strategy_trace: {
      strategy_id: "66666666-6666-4666-8666-666666666666",
      strategy_version: 1,
      week_number: 1,
      pillar_ids: [],
      objective: "awareness",
      channel: "facebook",
      funnel_stage: "awareness",
      content_purpose: "announce the weekly offer",
    },
    caption_variants: [
      {
        locale: "ar",
        dialect: "masry",
        caption: "جرّب عرضنا هذا الأسبوع",
        cta: null,
        hashtags: ["#عرضنا"],
      },
    ],
    cta: null,
    hashtags: ["#عرضنا"],
    creative_brief: "A clear product detail with warm daylight.",
    alt_text: "صورة المنتج",
    short_video_script: null,
    recommended_publish_window: {
      starts_at: "2026-08-10T15:00:00+03:00",
      ends_at: "2026-08-10T18:00:00+03:00",
      timezone: "Africa/Cairo",
      day_preference: "weekday",
      time_of_day_hint: "evening",
      rationale: "A practical evening window.",
    },
    claim_sources: [],
    warnings: [],
    blockers: [],
    asset_required: false,
    asset_ids: [],
    generation_provenance: {
      generation_run_id: "77777777-7777-4777-8777-777777777777",
      provider_name: "gemini",
      provider_model: "content-v2-test",
      generated_at: "2026-08-09T08:00:00+03:00",
    },
    version_checksum: checksum,
    created_at: "2026-08-09T08:00:00+03:00",
    edit_metadata: {
      edit_kind: "generated",
      base_version_id: null,
      base_version_checksum: null,
      edited_by_user_id: null,
      validation_state: "validated",
      edited_at: "2026-08-09T08:00:00+03:00",
    },
  };
}

function makeMedia(): ContentMediaLibraryEntryV2 {
  return {
    id: mediaId,
    contract_version: "content-v2",
    business_id: "88888888-8888-4888-8888-888888888888",
    content_cycle_id: cycleId,
    owner_user_id: "99999999-9999-4999-8999-999999999999",
    kind: "owner_uploaded",
    status: "ready",
    mime_type: "image/png",
    size_bytes: 128,
    width: 1080,
    height: 1080,
    checksum: "b".repeat(64),
    storage_key: null,
    failure_code: null,
    created_at: "2026-08-09T08:00:00+03:00",
    updated_at: "2026-08-09T08:00:00+03:00",
  };
}

function makeWorkspace(): ContentPackWorkspaceV2 {
  const version = makeVersion();
  return {
    contract_version: "content-v2",
    pack: {
      id: packId,
      contract_version: "content-v2",
      content_cycle_id: cycleId,
      weekly_claim_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      week_number: 1,
      business_id: "88888888-8888-4888-8888-888888888888",
      strategy_id: "66666666-6666-4666-8666-666666666666",
      strategy_version: 1,
      strategy_decision_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      profile_version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      week_context_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      status: "draft",
      retry_eligible: false,
      item_ids: [itemId],
      week_plan_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      created_at: "2026-08-09T08:00:00+03:00",
      updated_at: "2026-08-09T08:00:00+03:00",
    },
    week_number: 1,
    week_start_date: "2026-08-10",
    editorial_profile: null,
    media_library: [makeMedia()],
    items: [
      {
        content_item_id: itemId,
        plan: null,
        current_version: version,
        versions: [version],
        decision: null,
        assets: [],
        approval_state: "ready",
      },
    ],
    publication_candidate: null,
  };
}

type ReviewState = {
  workspace: ContentPackWorkspaceV2;
  workspaceGets: number;
  decisionCalls: number;
  lastDecisionBody: Record<string, unknown> | null;
};

function makeState(): ReviewState {
  return {
    workspace: makeWorkspace(),
    workspaceGets: 0,
    decisionCalls: 0,
    lastDecisionBody: null,
  };
}

async function authenticate(page: Page) {
  await mockAuthRefresh(page, mockAccessToken);
  await mockAuthMe(page);
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockContentReviewApi(page: Page, state: ReviewState) {
  await page.route(`**/api/v1/content-packs/${packId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await json(route, { id: packId, contract_version: "content-v2" });
  });

  await page.route(
    `**/api/v1/content-packs/${packId}/workspace`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      state.workspaceGets += 1;
      await json(route, state.workspace);
    },
  );

  await page.route(
    `**/api/v1/content-packs/${packId}/items/${itemId}/decisions`,
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      state.decisionCalls += 1;
      state.lastDecisionBody = (await route.request().postDataJSON()) as Record<
        string,
        unknown
      >;
      const body = state.lastDecisionBody;
      const version = state.workspace.items[0].current_version;
      const decision: ContentDecision = {
        id: `decision-${state.decisionCalls}`,
        content_item_id: itemId,
        content_item_version_id: version.id,
        content_item_version: version.version,
        content_item_version_checksum: version.version_checksum,
        decision: body.decision === "approved" ? "approved" : "rejected",
        revision_notes: null,
        decided_by_user_id: "99999999-9999-4999-8999-999999999999",
        decided_at: "2026-08-09T08:05:00+03:00",
      };
      state.workspace = {
        ...state.workspace,
        pack: { ...state.workspace.pack, status: "approved" },
        items: [
          {
            ...state.workspace.items[0],
            decision,
            approval_state: "approved",
          },
        ],
      };
      await json(route, { decision, publication_candidate: null });
    },
  );

  await page.route(
    `**/api/v1/content-cycles/${cycleId}/media/${mediaId}/file`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from([137, 80, 78, 71]),
      });
    },
  );
}

test.describe("Content V2 review workspace", () => {
  test("renders an owner-first draft without technical readiness or history noise", async ({
    page,
  }) => {
    const state = makeState();
    await authenticate(page);
    await mockContentReviewApi(page, state);

    await page.goto(`/en/content/packs/${packId}`);

    await expect(
      page.getByRole("heading", { name: "Review drafts" }),
    ).toBeVisible();
    await expect(page.getByText("جرّب عرضنا هذا الأسبوع")).toBeVisible();
    await expect(page.getByRole("region", { name: "Readiness" })).toHaveCount(
      0,
    );
    await expect(page.getByText("Version history")).toHaveCount(0);
    await expect(page.getByText("CONTENT_ASSET_REQUIRED")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit caption" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "AI rewrite" }),
    ).toBeVisible();
  });

  test("keeps media choices inside the post and exposes uploaded library images", async ({
    page,
  }) => {
    await authenticate(page);
    await mockContentReviewApi(page, makeState());

    await page.goto(`/en/content/packs/${packId}`);
    await page.getByRole("button", { name: "Choose from library" }).click();
    await expect(
      page.getByRole("button", { name: /Uploaded image/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Generate visual" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Post visual" }),
    ).toBeVisible();
  });

  test("approving refreshes the workspace and freezes the post controls", async ({
    page,
  }) => {
    const state = makeState();
    await authenticate(page);
    await mockContentReviewApi(page, state);

    await page.goto(`/en/content/packs/${packId}`);
    await page.getByRole("button", { name: "Approve" }).click();

    await expect(
      page.getByRole("heading", { name: "Approved posts" }),
    ).toBeVisible();
    await expect(page.getByText("This pack is approved")).toBeVisible();
    await expect(page.getByText(/Approved and locked\./)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit caption" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "AI rewrite" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Choose from library" }),
    ).toHaveCount(0);
    await expect.poll(() => state.decisionCalls).toBe(1);
    expect(state.lastDecisionBody).toMatchObject({
      content_item_id: itemId,
      content_item_version_id: versionId,
      content_item_version_checksum: checksum,
      decision: "approved",
    });
    await expect.poll(() => state.workspaceGets).toBeGreaterThanOrEqual(2);
  });

  test("renders Arabic review in RTL while preserving the single approval action", async ({
    page,
  }) => {
    await authenticate(page);
    await mockContentReviewApi(page, makeState());

    await page.goto(`/ar/content/packs/${packId}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: "مراجعة المسودات" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "اعتمد" })).toHaveCount(1);
    await expect(page.getByText("جرّب عرضنا هذا الأسبوع")).toHaveAttribute(
      "dir",
      "rtl",
    );
  });

  test("keeps the shared mobile navigation available", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "The bottom nav is intentionally hidden on desktop.",
    );
    await authenticate(page);
    await mockContentReviewApi(page, makeState());
    await page.goto(`/en/content/packs/${packId}`);
    await expect(
      page.getByRole("navigation", { name: "Mobile primary" }),
    ).toHaveClass(/fixed/);
  });
});
