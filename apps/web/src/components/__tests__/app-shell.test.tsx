import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { screen } from "@testing-library/dom";
import { AppShell, isAppNavItemActive } from "../layout/app-shell";

const t = (key: string) => {
  const dict: Record<string, string> = {
    appName: "MarketMind",
    navHome: "Home",
    navDiscovery: "Discovery",
    navDashboard: "Dashboard",
    navStrategy: "Strategy",
    navPublishing: "Publishing",
    navPerformance: "Content performance",
    navConnections: "Connections",
    navBilling: "Billing",
    primaryNavLabel: "Primary",
    mobileNavLabel: "Mobile primary",
    workspaceLabel: "Workspace",
    tagline: "Marketing intelligence for SMEs",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    ownerControlHint: "Every important step waits for a clear owner decision.",
    loginSubmit: "Sign in",
    registerSubmit: "Create account",
    logout: "Sign out",
  };
  return dict[key] ?? key;
};

vi.mock("next-intl", () => ({
  useTranslations: () => t,
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
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
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/components/language-switcher", () => ({
  LanguageSwitcher: () => (
    <button type="button" aria-label="Language: Arabic">
      AR
    </button>
  ),
}));

let authenticated = false;
let userMock: { id: string; email: string; fullName: string } | null = null;

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({ isAuthenticated: authenticated, user: userMock }),
}));

vi.mock("@/features/auth/logout-button", () => ({
  LogoutButton: ({ size }: { size?: string }) => (
    <button type="button" data-size={size}>
      Sign out
    </button>
  ),
}));

vi.mock("@/lib/api/billing", () => ({
  getBillingWallet: () =>
    Promise.resolve({
      billing_account_id: "acc-1",
      balance: 215,
      lifetime_granted: 365,
      lifetime_spent: 150,
      low_balance: false,
    }),
}));

describe("AppShell", () => {
  it("does not keep Dashboard active on a different section", () => {
    expect(isAppNavItemActive("/dashboard", "/dashboard")).toBe(true);
    expect(isAppNavItemActive("/strategy", "/dashboard")).toBe(false);
    expect(isAppNavItemActive("/strategy/review", "/strategy")).toBe(true);
  });

  it("renders brand in both mobile top bar and desktop sidebar", () => {
    render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );
    const brands = screen.getAllByRole("img", { name: "MarketMind" });
    expect(brands).toHaveLength(2);
    const sidebarBrand = brands.find((brand) => brand.closest("aside"));
    expect(sidebarBrand?.closest("aside")?.textContent).not.toMatch(
      /Marketing intelligence for SMEs/,
    );
  });

  it("renders primary desktop sidebar and fixed mobile bottom nav with all destinations", () => {
    render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );

    const primaryNavs = screen.getAllByLabelText("Primary");
    expect(primaryNavs).toHaveLength(1);
    expect(primaryNavs[0].closest("aside")?.className).toMatch(
      /(^|\s)hidden(\s|$)/,
    );
    expect(primaryNavs[0].closest("aside")?.className).toMatch(/lg:flex/);

    const mobileNav = screen.getByLabelText("Mobile primary");
    expect(mobileNav.className).toMatch(/fixed/);
    expect(mobileNav.className).toMatch(/bottom-0/);
    expect(mobileNav.className).not.toMatch(/grid-cols-6/);

    const navList = mobileNav.querySelector("ul");
    expect(navList?.className).toMatch(/overflow-x-auto/);
    expect(navList?.className).toMatch(/flex/);
    expect(navList?.className).not.toMatch(/grid-cols-6/);
    const items = mobileNav.querySelectorAll("li");
    expect(items.length).toBe(8);
    for (const item of Array.from(items)) {
      expect((item as HTMLElement).className).toMatch(/min-w-\[4\.5rem\] flex-none/);
    }

    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Discovery" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Dashboard" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Strategy" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Publishing" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Content performance" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Connections" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Billing" })).toHaveLength(2);
  });

  it("marks the dashboard link as current in both navs", () => {
    render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );
    const dashboardLinks = screen.getAllByRole("link", { name: "Dashboard" });
    for (const link of dashboardLinks) {
      expect(link.getAttribute("aria-current")).toBe("page");
    }
  });

  it("keeps content inside a max-width 1200 container", () => {
    const { container } = render(
      <AppShell brandName="MarketMind">
        <p data-testid="copy">body</p>
      </AppShell>,
    );
    const main = container.querySelector("main#main-content");
    expect(main?.parentElement?.className).toMatch(/lg:ms-\[260px\]/);
    expect(main?.className).toMatch(/max-w-\[1200px\]/);
    expect(main?.className).toMatch(/scroll-mt-16/);
    expect(main?.getAttribute("tabindex")).toBe("-1");
    expect(main?.className).not.toMatch(/lg:ms-\[260px\]/);
    expect(main?.textContent).toMatch(/body/);
  });

  it("renders login and register actions in the desktop top bar when unauthenticated", () => {
    authenticated = false;
    const { container } = render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );

    const desktopTopBar = container.querySelector("header.hidden")!;
    expect(desktopTopBar.textContent).toMatch(/Sign in/);
    expect(desktopTopBar.textContent).toMatch(/Create account/);
  });

  it("renders logout action in the desktop top bar when authenticated", () => {
    authenticated = true;
    const { container } = render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );

    const desktopTopBar = container.querySelector("header.hidden")!;
    expect(desktopTopBar.textContent).toMatch(/Sign out/);
  });

  it("renders auth actions in the mobile top bar", () => {
    authenticated = false;
    render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );

    const mobileTopBar = screen
      .getAllByRole("banner")
      .find((element) => element.className.includes("lg:hidden"))!;
    expect(mobileTopBar.textContent).toMatch(/Sign in/);
    expect(mobileTopBar.textContent).toMatch(/Create account/);
  });

  it("can collapse the desktop sidebar", () => {
    const { container } = render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    const main = container.querySelector("main#main-content");
    expect(main?.parentElement?.className).toMatch(/lg:ms-\[84px\]/);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("keeps the mobile navigation visible without a modal drawer", () => {
    const { baseElement } = render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByLabelText("Mobile primary")).toBeTruthy();
    expect(baseElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders signed-in user name and computed initials avatar in desktop sidebar", () => {
    authenticated = true;
    userMock = { id: "1", email: "ahmed@example.com", fullName: "Ahmed Mohamed" };
    render(
      <AppShell brandName="MarketMind">
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText("Ahmed Mohamed")).toBeTruthy();
    expect(screen.getByText("AM")).toBeTruthy();
  });

  it("renders remaining points in the desktop sidebar when authenticated", async () => {
    authenticated = true;
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    );

    expect(await screen.findByText("215")).toBeTruthy();
    expect(screen.getByRole("link", { name: "topUp" })).toBeTruthy();
  });

  it("hides the sidebar points card when unauthenticated", () => {
    authenticated = false;
    const { container } = render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    );

    expect(container.textContent).not.toMatch(/215/);
  });
});
