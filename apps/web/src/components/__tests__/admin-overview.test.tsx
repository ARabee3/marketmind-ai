import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react"
import AdminOverviewPage from "@/app/[locale]/(admin)/admin/page"
import {
  getAdminRevenueSummary,
  getAdminUsers,
} from "@/lib/api/admin"
import { listBillingCostAlerts } from "@/lib/api/admin-billing"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "time" in values
      ? `Last refreshed ${String(values.time)}`
      : key,
  useFormatter: () => ({
    dateTime: () => "10:00 AM",
    number: () => "EGP 299",
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
  getAdminRevenueSummary: vi.fn(),
  getAdminUsers: vi.fn(),
}))

vi.mock("@/lib/api/admin-billing", () => ({
  listBillingCostAlerts: vi.fn(),
}))

const getAdminRevenueSummaryMock = vi.mocked(getAdminRevenueSummary)
const getAdminUsersMock = vi.mocked(getAdminUsers)
const listBillingCostAlertsMock = vi.mocked(listBillingCostAlerts)

const summaryWithNeeds = {
  activeBusinesses: 3,
  activeSubscriptions: 5,
  trialingCount: 1,
  mrrEgp: 548,
  pastDueSubscriptions: 2,
  expiredSubscriptions: 7,
  unverifiedUsers: 9,
}
const summaryAllClear = {
  ...summaryWithNeeds,
  pastDueSubscriptions: 0,
  expiredSubscriptions: 0,
  unverifiedUsers: 0,
}

function emptyUsersPage(total = 0) {
  return { items: [], total, page: 1, pageSize: 5 }
}

describe("AdminOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listBillingCostAlertsMock.mockResolvedValue({
      alerts: [],
      cohort95thPercentileEgp: null,
      totalAccountsAboveEgp50: 0,
      totalHighRetryArtifacts: 0,
    })
  })

  it("renders the admin console hero banner", async () => {
    getAdminRevenueSummaryMock.mockResolvedValue(summaryAllClear)
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
    getAdminRevenueSummaryMock.mockResolvedValue(summaryWithNeeds)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage(42))

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    const needsAttention = await screen.findByTestId("admin-needs-attention")

    await waitFor(() => {
      expect(within(needsAttention).getByText("pastDueSubscriptions")).toBeDefined()
      expect(within(needsAttention).getByText("expiredSubscriptions")).toBeDefined()
      expect(within(needsAttention).getByText("unverifiedUsers")).toBeDefined()
    })
    expect(within(needsAttention).getByText("2")).toBeDefined()
    expect(within(needsAttention).getByText("7")).toBeDefined()
    expect(within(needsAttention).getByText("9")).toBeDefined()
    expect(within(needsAttention).getAllByText("viewDetails")).toHaveLength(3)
  })

  it("shows the all-clear healthy state when no counts need attention", async () => {
    getAdminRevenueSummaryMock.mockResolvedValue(summaryAllClear)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage())

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    await waitFor(() => {
      expect(screen.getByText("allClear")).toBeDefined()
    })
    expect(screen.queryByText("viewDetails")).toBeNull()
  })

  it("surfaces billing cost alerts as a needs-attention row", async () => {
    getAdminRevenueSummaryMock.mockResolvedValue(summaryAllClear)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage())
    listBillingCostAlertsMock.mockResolvedValue({
      alerts: [
        {
          billingAccountId: "acc-1",
          ownerEmail: "a@example.com",
          ownerFullName: null,
          billingPeriodStart: "2026-08-01T00:00:00.000Z",
          totalEgpCost: 60,
          artifactCount: 2,
          highRetryArtifacts: 1,
          reason: "monthly_cost_exceeded_egp_50",
        },
      ],
      cohort95thPercentileEgp: 42,
      totalAccountsAboveEgp50: 1,
      totalHighRetryArtifacts: 1,
    })

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    const needsAttention = await screen.findByTestId("admin-needs-attention")

    await waitFor(() => {
      expect(
        within(needsAttention).getByText("billingCostAlertsShort"),
      ).toBeDefined()
    })
    expect(within(needsAttention).getByText("2")).toBeDefined()
    expect(
      within(needsAttention).getByRole("link").getAttribute("href"),
    ).toBe("/admin/billing")
  })

  it("renders metric cards from revenue and user totals", async () => {
    getAdminRevenueSummaryMock.mockResolvedValue(summaryWithNeeds)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage(42))

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    const metrics = await screen.findByTestId("admin-metrics")

    await waitFor(() => {
      expect(within(metrics).getByText("totalUsers")).toBeDefined()
      expect(within(metrics).getByText("activeBusinesses")).toBeDefined()
      expect(within(metrics).getByText("activeSubscriptions")).toBeDefined()
      expect(within(metrics).getByText("mrr")).toBeDefined()
    })
    const values = within(metrics)
      .getAllByTestId("metric-value")
      .map((el) => el.textContent)
    expect(values).toContain("42")
    expect(values).toContain("3")
    expect(values).toContain("5")
    expect(values).toContain("EGP 299")
  })

  it("renders Last-refreshed timestamp and a Refresh action that re-fetches", async () => {
    getAdminRevenueSummaryMock.mockResolvedValue(summaryAllClear)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage())

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    const refreshBtn = await screen.findByText("refresh")
    expect(refreshBtn.tagName).toBe("BUTTON")
    expect(screen.getByText(/Last refreshed/)).toBeDefined()

    const callsBefore = getAdminRevenueSummaryMock.mock.calls.length
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(getAdminRevenueSummaryMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})
