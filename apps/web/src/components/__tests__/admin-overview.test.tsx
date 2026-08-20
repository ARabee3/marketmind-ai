import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react"
import AdminOverviewPage from "@/app/[locale]/(admin)/admin/page"
import {
  getAdminUsers,
} from "@/lib/api/admin"
import { getWalletOverview } from "@/lib/api/admin-billing"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "time" in values
      ? `Last refreshed ${String(values.time)}`
      : key,
  useFormatter: () => ({
    dateTime: () => "10:00 AM",
    number: (value: number, options?: { style?: string }) =>
      options?.style === "currency" ? `EGP ${value}` : String(value),
  }),
  useLocale: () => "en",
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    "aria-label"?: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("@/lib/api/admin", () => ({
  getAdminUsers: vi.fn(),
}))
vi.mock("@/lib/api/admin-billing", () => ({
  getWalletOverview: vi.fn(),
}))

const getWalletOverviewMock = vi.mocked(getWalletOverview)
const getAdminUsersMock = vi.mocked(getAdminUsers)

const overviewWithNeeds = {
  totalAccounts: 4,
  activeAccounts: 3,
  pausedAccounts: 2,
  totalPointsOutstanding: 1200,
  totalLifetimeGranted: 5000,
  totalLifetimeSpent: 3800,
  totalTopUpEgp: 548,
  totalTopUpCount: 12,
  unverifiedUsers: 9,
}
const overviewAllClear = {
  ...overviewWithNeeds,
  pausedAccounts: 0,
  unverifiedUsers: 9,
}

function emptyUsersPage(total = 0) {
  return { items: [], total, page: 1, pageSize: 5 }
}

describe("AdminOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the admin console hero banner", async () => {
    getWalletOverviewMock.mockResolvedValue({
      ...overviewAllClear,
      unverifiedUsers: 0,
    })
    getAdminUsersMock.mockResolvedValue(emptyUsersPage())

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    await waitFor(() => {
      expect(screen.getByText("adminConsole")).toBeDefined()
      expect(screen.getByText("overviewDescription")).toBeDefined()
      expect(screen.getByRole("link", { name: "viewAllUsers" })).toBeDefined()
    })
  })

  it("renders Needs-attention rows from the summary counts", async () => {
    getWalletOverviewMock.mockResolvedValue(overviewWithNeeds)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage(42))

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    const needsAttention = await screen.findByTestId("admin-needs-attention")

    await waitFor(() => {
      expect(within(needsAttention).getByText("pausedWallets")).toBeDefined()
      expect(within(needsAttention).getByText("unverifiedUsers")).toBeDefined()
    })
    expect(within(needsAttention).getByText("2")).toBeDefined()
    expect(within(needsAttention).getByText("9")).toBeDefined()
    expect(within(needsAttention).getAllByText("viewDetails")).toHaveLength(2)
  })

  it("shows the all-clear healthy state when no counts need attention", async () => {
    getWalletOverviewMock.mockResolvedValue({
      ...overviewAllClear,
      unverifiedUsers: 0,
    })
    getAdminUsersMock.mockResolvedValue(emptyUsersPage())

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    await waitFor(() => {
      expect(screen.getByText("allClear")).toBeDefined()
    })
    expect(screen.queryByText("viewDetails")).toBeNull()
  })

  it("renders metric cards from revenue and user totals", async () => {
    getWalletOverviewMock.mockResolvedValue(overviewWithNeeds)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage(42))

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    const metrics = await screen.findByTestId("admin-metrics")

    await waitFor(() => {
      expect(within(metrics).getByText("totalUsers")).toBeDefined()
      expect(within(metrics).getByText("activeWallets")).toBeDefined()
      expect(within(metrics).getByText("pointsOutstanding")).toBeDefined()
      expect(within(metrics).getByText("topUpEgp")).toBeDefined()
    })
    const values = within(metrics)
      .getAllByTestId("metric-value")
      .map((el) => el.textContent)
    expect(values).toContain("42")
    expect(values).toContain("3")
    expect(values).toContain("1200")
    expect(values).toContain("EGP 548")
  })

  it("renders Last-refreshed timestamp and a Refresh action that re-fetches", async () => {
    getWalletOverviewMock.mockResolvedValue({
      ...overviewAllClear,
      unverifiedUsers: 0,
    })
    getAdminUsersMock.mockResolvedValue(emptyUsersPage())

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    const refreshBtn = await screen.findByText("refresh")
    expect(refreshBtn.tagName).toBe("BUTTON")
    expect(screen.getByText(/Last refreshed/)).toBeDefined()

    const callsBefore = getWalletOverviewMock.mock.calls.length
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(getWalletOverviewMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})
