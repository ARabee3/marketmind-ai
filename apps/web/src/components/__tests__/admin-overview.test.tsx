import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { StatTile } from "../ui/stat-tile"
import AdminOverviewPage from "@/app/[locale]/(admin)/admin/page"
import {
  getAdminRevenueSummary,
  getAdminUsers,
} from "@/lib/api/admin"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "time" in values
      ? `Last refreshed ${String(values.time)}`
      : key,
  useFormatter: () => ({
    dateTime: () => "10:00 AM",
    number: (_: number) => "EGP 299",
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

const getAdminRevenueSummaryMock = vi.mocked(getAdminRevenueSummary)
const getAdminUsersMock = vi.mocked(getAdminUsers)

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

describe("StatTile clickable variant", () => {
  it("renders as a link when href is provided", () => {
    const { container } = render(
      <StatTile label="Total Users" value="42" href="/admin/users" ariaLabel="View all users" />,
    )
    const anchor = container.querySelector("a")
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute("href")).toBe("/admin/users")
    expect(anchor?.getAttribute("aria-label")).toBe("View all users")
    expect(screen.getByText("Total Users")).toBeDefined()
    expect(screen.getByText("42")).toBeDefined()
  })

  it("renders no anchor when href is omitted", () => {
    const { container } = render(<StatTile label="MRR" value="EGP 299" />)
    expect(container.querySelector("a")).toBeNull()
    expect(screen.getByText("MRR")).toBeDefined()
  })
})

describe("AdminOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders Needs-attention rows from the summary counts", async () => {
    getAdminRevenueSummaryMock.mockResolvedValue(summaryWithNeeds)
    getAdminUsersMock.mockResolvedValue(emptyUsersPage(42))

    await act(async () => {
      render(<AdminOverviewPage />)
    })

    await waitFor(() => {
      expect(screen.getByText("pastDueSubscriptions")).toBeDefined()
      expect(screen.getByText("expiredSubscriptions")).toBeDefined()
      expect(screen.getByText("unverifiedUsers")).toBeDefined()
    })
    expect(screen.getByText("2")).toBeDefined()
    expect(screen.getByText("7")).toBeDefined()
    expect(screen.getByText("9")).toBeDefined()
    expect(screen.getAllByText("viewDetails")).toHaveLength(3)
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