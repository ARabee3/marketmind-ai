import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import AdminBillingPage from "../billing/page"
import {
  listBillingAccounts,
  listBillingCostAlerts,
  listBillingReconciliationMismatches,
  pauseBillingAccount,
  resumeBillingAccount,
} from "@/lib/api/admin-billing"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      pageOfPages: "Page {page} of {totalPages}",
      previous: "Previous",
      next: "Next",
      previousPage: "Previous page",
      nextPage: "Next page",
      paginationLabel: "Pagination",
      costAlertHighRetry: "Artifact used {count} attempts",
      billingAccountIdShort: "ID {id}",
      egpAmount: "EGP {amount}",
      pauseAccountDescription: "Pause {name}?",
      resumeAccountDescription: "Resume {name}?",
      billingPausedAt: "Paused {time}",
    }
    let message = messages[key] ?? key
    for (const [name, value] of Object.entries(values ?? {})) {
      message = message.replace(`{${name}}`, String(value))
    }
    return message
  },
  useFormatter: () => ({
    dateTime: () => "Jan 1, 2024",
  }),
}))

vi.mock("@/lib/api/admin-billing", () => ({
  listBillingAccounts: vi.fn(),
  listBillingCostAlerts: vi.fn(),
  listBillingReconciliationMismatches: vi.fn(),
  pauseBillingAccount: vi.fn(),
  resumeBillingAccount: vi.fn(),
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))

const listAccountsMock = vi.mocked(listBillingAccounts)
const listCostAlertsMock = vi.mocked(listBillingCostAlerts)
const listMismatchesMock = vi.mocked(listBillingReconciliationMismatches)
const pauseMock = vi.mocked(pauseBillingAccount)
const resumeMock = vi.mocked(resumeBillingAccount)

function makeAccount(overrides: {
  id?: string
  ownerEmail?: string
  ownerFullName?: string | null
  status?: string
  pausedReason?: string | null
  pausedAt?: string | null
} = {}) {
  const {
    id = "acc-1",
    ownerEmail = "owner@example.com",
    ownerFullName = "Cairo Owner",
    status = "active",
    pausedReason = null,
    pausedAt = null,
  } = overrides
  return {
    id,
    ownerUserId: `user-${id}`,
    ownerEmail,
    ownerFullName,
    status,
    pausedReason,
    pausedAt,
    createdAt: "2024-01-01T00:00:00.000Z",
  }
}

function allClearAlerts() {
  return {
    alerts: [],
    cohort95thPercentileEgp: null,
    totalAccountsAboveEgp50: 0,
    totalHighRetryArtifacts: 0,
  }
}

describe("AdminBillingPage", () => {
  beforeEach(() => {
    listAccountsMock.mockReset()
    listCostAlertsMock.mockReset()
    listMismatchesMock.mockReset()
    pauseMock.mockReset()
    resumeMock.mockReset()
    listAccountsMock.mockResolvedValue({
      items: [makeAccount()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    listCostAlertsMock.mockResolvedValue(allClearAlerts())
    listMismatchesMock.mockResolvedValue([])
  })

  it("renders the billing header and account table", async () => {
    await waitFor(() => {
      render(<AdminBillingPage />)
    })

    expect(await screen.findByText("billingDescription")).toBeDefined()
    expect(await screen.findByText("owner@example.com")).toBeDefined()
    expect(screen.getByText("billingAccountsTitle")).toBeDefined()
    expect(screen.getByText("costAlertsAllClear")).toBeDefined()
    expect(screen.getByText("reconciliationAllClear")).toBeDefined()
  })

  it("opens the pause dialog and submits a reason", async () => {
    await waitFor(() => {
      render(<AdminBillingPage />)
    })

    const pauseButton = await screen.findByRole("button", { name: "pauseAccount" })
    fireEvent.click(pauseButton)

    expect(await screen.findByText("pauseAccountTitle")).toBeDefined()

    pauseMock.mockResolvedValue({
      ...makeAccount({ status: "paused", pausedReason: "Fraud risk" }),
    })

    const reasonInput = screen.getByPlaceholderText("reasonPlaceholder")
    fireEvent.change(reasonInput, { target: { value: "Fraud risk" } })
    fireEvent.click(screen.getByRole("button", { name: "pauseAccount" }))

    await waitFor(() => {
      expect(pauseMock).toHaveBeenCalledWith("acc-1", "Fraud risk")
    })
  })

  it("opens the resume dialog for a paused account", async () => {
    listAccountsMock.mockResolvedValue({
      items: [
        makeAccount({
          id: "acc-2",
          status: "paused",
          pausedReason: "Fraud risk",
          pausedAt: "2024-02-01T00:00:00.000Z",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    await waitFor(() => {
      render(<AdminBillingPage />)
    })

    const resumeButton = await screen.findByRole("button", { name: "resumeAccount" })
    fireEvent.click(resumeButton)

    expect(await screen.findByText("resumeAccountTitle")).toBeDefined()

    resumeMock.mockResolvedValue(makeAccount())

    fireEvent.click(screen.getByRole("button", { name: "resumeAccount" }))

    await waitFor(() => {
      expect(resumeMock).toHaveBeenCalledWith("acc-2")
    })
  })

  it("renders cost alert rows from the summary", async () => {
    listCostAlertsMock.mockResolvedValue({
      alerts: [
        {
          billingAccountId: "acc-1",
          ownerEmail: "owner@example.com",
          ownerFullName: "Cairo Owner",
          billingPeriodStart: "2026-08-01T00:00:00.000Z",
          totalEgpCost: 60,
          artifactCount: 2,
          highRetryArtifacts: 0,
          reason: "monthly_cost_exceeded_egp_50",
        },
      ],
      cohort95thPercentileEgp: 42,
      totalAccountsAboveEgp50: 1,
      totalHighRetryArtifacts: 0,
    })

    await waitFor(() => {
      render(<AdminBillingPage />)
    })

    expect(await screen.findByText("costAlertOverEgp50")).toBeDefined()
    expect(screen.getByText("EGP 60")).toBeDefined()
  })

  it("renders reconciliation mismatch rows", async () => {
    listMismatchesMock.mockResolvedValue([
      {
        billingAccountId: "acc-1",
        ownerEmail: "owner@example.com",
        mismatchType: "succeeded_attempt_no_transaction",
        attemptId: "attempt-1",
        eventId: null,
        transactionId: null,
        providerCheckoutRef: "ref-1",
        occurredAt: "2026-08-01T00:00:00.000Z",
      },
    ])

    await waitFor(() => {
      render(<AdminBillingPage />)
    })

    expect(
      await screen.findByText("mismatchAttemptNoTransaction"),
    ).toBeDefined()
    expect(screen.getByText("ref-1")).toBeDefined()
  })
})