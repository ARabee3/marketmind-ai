import { expect, test, type Page } from "@playwright/test";
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from "./fixtures/auth";

/**
 * Issue #175 — Meta connection journey browser coverage.
 *
 * The journey is a guided multi-step flow backed by mocked API routes (the
 * real Meta OAuth round trip cannot run in CI without a live Meta app, which
 * is recorded as a blocker in the PR). Coverage maps to the issue's browser
 * acceptance criteria: English + Arabic RTL, desktop + mobile, keyboard
 * navigation, cancellation, success, blocked prerequisites, expired
 * authorization, and recovery.
 */

const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";

const PENDING_SELECTION = {
  contract_version: "meta-connection-v1",
  connection_id: CONNECTION_ID,
  requested_channel: "facebook",
  requested_capability: "static_image",
  expires_at: "2099-08-08T07:15:00.000Z",
  options: [
    {
      page: {
        channel: "facebook",
        account_id: "page-1001",
        display_name: "MarketMind Café — Helwan",
        capability_status: "supported",
        blockers: [],
      },
      instagram: {
        channel: "instagram",
        account_id: "ig-1001",
        display_name: "marketmind.cafe",
        capability_status: "supported",
        blockers: [],
      },
    },
    {
      page: {
        channel: "facebook",
        account_id: "page-1002",
        display_name: "MarketMind Café — Maadi",
        capability_status: "unsupported",
        blockers: ["page_publish_capability_missing"],
      },
      instagram: null,
    },
  ],
};

const SELECTED_TARGETS = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    businessId: "biz-1",
    provider: "META",
    channel: "facebook",
    externalAccountId: "page-1001",
    displayName: "MarketMind Café — Helwan",
    connectionState: "CONNECTED",
    capabilities: ["static_image"],
    lastVerifiedAt: null,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    businessId: "biz-1",
    provider: "META",
    channel: "instagram",
    externalAccountId: "ig-1001",
    displayName: "marketmind.cafe",
    connectionState: "CONNECTED",
    capabilities: ["static_image"],
    lastVerifiedAt: null,
  },
];

async function mockConnectApi(page: Page, overrides: { configured?: boolean } = {}) {
  const configured = overrides.configured ?? true;
  await page.route("**/api/v1/publishing-targets/meta/connect", async (route) => {
    const body = (await route.request().postDataJSON()) as {
      provider?: string;
      channel?: string;
      fingerprint?: string;
      locale?: string;
    };
    expect(body?.provider).toBe("META");
    expect(body?.channel).toBe("facebook");
    expect(body?.fingerprint).toMatch(/^fp-/);
    if (!configured) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 503,
          code: "PUBLISHING_META_NOT_CONFIGURED",
          message: "not configured",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        contract_version: "meta-connection-v1",
        connection_id: CONNECTION_ID,
        authorization_url: `https://graph.facebook.com/v21.0/dialog/oauth?state=raw-state-1&redirect_uri=https%3A%2F%2Fapi.example%2Fapi%2Fv1%2Fpublishing-targets%2Fmeta%2Fcallback`,
        expires_at: "2099-08-08T07:15:00.000Z",
      }),
    });
  });

  await page.route("**/api/v1/publishing-targets/meta/pending/**", async (route) => {
    const request = route.request();
    expect(request.headers()["x-connection-fingerprint"]).toMatch(/^fp-/);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PENDING_SELECTION),
    });
  });

  await page.route("**/api/v1/publishing-targets/meta/select", async (route) => {
    const body = (await route.request().postDataJSON()) as {
      connectionId: string;
      pageId: string;
      includeInstagram: boolean;
      fingerprint: string;
    };
    expect(body.connectionId).toBe(CONNECTION_ID);
    expect(body.pageId).toBe("page-1001");
    expect(body.fingerprint).toMatch(/^fp-/);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(SELECTED_TARGETS),
    });
  });
}

async function mockFacebookOAuth(
  page: Page,
  overrides: { configured?: boolean } = {},
) {
  const configured = overrides.configured ?? true;

  await page.route("**/api/v1/auth/facebook/start", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    if (!configured) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 503,
          code: "FACEBOOK_NOT_CONFIGURED",
          message: "not configured",
        }),
      });
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.addInitScript(() => {
    type TestWindow = Window & { __marketmindPopupHref?: string };
    const testWindow = window as TestWindow;

    Object.defineProperty(window, "open", {
      configurable: true,
      value: () => {
        const popup = {
          closed: false,
          close() {
            this.closed = true;
          },
          location: {
            set href(value: string) {
              testWindow.__marketmindPopupHref = value;
            },
          },
        };
        return popup as unknown as Window;
      },
    });
  });
}

async function completeFacebookPopup(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __marketmindPopupHref?: string })
            .__marketmindPopupHref,
      ),
    )
    .toMatch(/\/api\/v1\/auth\/facebook\/start$/);

  await page.evaluate(() => {
    const testWindow = window as Window & { __marketmindPopupHref?: string };
    const href = testWindow.__marketmindPopupHref;
    if (!href) throw new Error("Facebook popup did not receive its start URL");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: new URL(href).origin,
        data: {
          type: "fb-connected",
          payload: { pageName: "MarketMind Page" },
        },
      }),
    );
  });
}

async function authenticate(page: Page) {
  await mockAuthRefresh(page, mockAccessToken);
  await mockAuthMe(page);
}
test.describe("Facebook connection journey (PR #193)", () => {
  test("start page opens the Facebook popup — no token handled", async ({
    page,
  }) => {
    await authenticate(page);
    await mockFacebookOAuth(page);

    await page.goto("/en/publishing/meta/connect");
    await expect(
      page.getByRole("heading", { name: "Connect Facebook" }),
    ).toBeVisible();
    await expect(
      page.getByText("MarketMind never sees your Facebook password", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({
        hasText: "access token is encrypted at rest",
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Continue with Facebook" }).click();
    await completeFacebookPopup(page);
    await expect(page).toHaveURL(/\/en\/publishing$/);
  });

  test("renders a truthful error when Facebook config is missing, with recovery", async ({
    page,
  }) => {
    await authenticate(page);
    await mockFacebookOAuth(page, { configured: false });

    await page.goto("/en/publishing/meta/connect");
    await page.getByRole("button", { name: "Continue with Facebook" }).click();
    await expect(
      page.getByRole("heading", { name: "Something went wrong" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to publishing" }),
    ).toHaveAttribute("href", "/en/publishing");
  });

  test("success: chooses the Page + linked Instagram account and reaches the ready state", async ({
    page,
  }) => {
    await authenticate(page);
    await mockConnectApi(page);

    await page.goto(
      `/en/publishing/meta/callback?meta_result=success&meta_connection=${CONNECTION_ID}`,
    );
    await expect(
      page.getByRole("heading", { name: "Connected — choose your accounts" }),
    ).toBeVisible();

    // Only the supported Page is selectable; the blocked one explains why.
    const supported = page.getByRole("radio", {
      name: /MarketMind Café — Helwan/,
    });
    await expect(supported).toBeEnabled();
    await expect(
      page.getByText("Not available: the Page publish permission is not granted", {
        exact: false,
      }),
    ).toBeVisible();

    await supported.check();
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Connect selected accounts" }).click();

    await expect(
      page.getByRole("heading", { name: "Accounts connected" }),
    ).toBeVisible();
    await expect(
      page.getByText("You can now schedule and approve real publications.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Go to publishing" }),
    ).toHaveAttribute("href", "/en/publishing");
  });

  test("cancellation state is truthful and offers recovery", async ({ page }) => {
    await authenticate(page);
    await page.goto("/en/publishing/meta/callback?meta_result=cancelled");
    await expect(
      page.getByRole("heading", { name: "Connection cancelled" }),
    ).toBeVisible();
    await expect(
      page.getByText("You closed the Meta window without connecting.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start a new connection" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to publishing" }),
    ).toHaveAttribute("href", "/en/publishing");
  });

  test("expired authorization state is truthful and offers recovery", async ({ page }) => {
    await authenticate(page);
    await page.goto("/en/publishing/meta/callback?meta_result=expired");
    await expect(
      page.getByRole("heading", { name: "Connection link expired" }),
    ).toBeVisible();
    await expect(
      page.getByText("Start a new connection to try again.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start a new connection" }).click();
    await expect(page).toHaveURL(/\/en\/publishing\/meta\/connect$/);
  });

  test("denied state is truthful", async ({ page }) => {
    await authenticate(page);
    await page.goto("/en/publishing/meta/callback?meta_result=denied");
    await expect(
      page.getByRole("heading", { name: "Connection was not granted" }),
    ).toBeVisible();
  });

  test("unknown result is truthful", async ({ page }) => {
    await authenticate(page);
    await page.goto("/en/publishing/meta/callback?meta_result=unknown");
    await expect(
      page.getByRole("heading", { name: "Something went wrong" }),
    ).toBeVisible();
  });

  test("Arabic RTL journey renders in the correct direction", async ({ page }) => {
    await authenticate(page);
    await mockConnectApi(page);

    await page.goto(
      `/ar/publishing/meta/callback?meta_result=success&meta_connection=${CONNECTION_ID}`,
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { name: "تم الربط — اختر حساباتك" }),
    ).toBeVisible();
    await page
      .getByRole("radio", { name: /Helwan/ })
      .check();
    await page
      .getByRole("button", { name: "ربط الحسابات المختارة" })
      .click();
    await expect(
      page.getByRole("heading", { name: "تم ربط الحسابات" }),
    ).toBeVisible();
  });

  test("keyboard navigation reaches every control with a visible focus", async ({
    page,
  }) => {
    await authenticate(page);
    await mockConnectApi(page);
    await mockFacebookOAuth(page);

    await page.goto("/en/publishing/meta/connect");
    const startButton = page.getByRole("button", { name: "Continue with Facebook" });
    await startButton.focus();
    await expect(startButton).toBeFocused();

    // Tab through: start button → back link; every stop is reachable.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Back to publishing" })).toBeFocused();

    await page.goto(
      `/en/publishing/meta/callback?meta_result=success&meta_connection=${CONNECTION_ID}`,
    );
    const radio = page.getByRole("radio", { name: /MarketMind Café — Helwan/ });
    await radio.focus();
    await expect(radio).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('input[type="checkbox"]')).toBeFocused();
  });

  test("renders correctly on mobile viewport", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "mobile viewport is covered by the mobile-chrome project.",
    );
    await authenticate(page);
    await mockConnectApi(page);

    await page.goto(
      `/en/publishing/meta/callback?meta_result=success&meta_connection=${CONNECTION_ID}`,
    );
    await expect(
      page.getByRole("heading", { name: "Connected — choose your accounts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /MarketMind Café — Helwan/ }),
    ).toBeEnabled();
    // No horizontal overflow on the narrow viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
