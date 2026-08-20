import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminRevenuePage from "../revenue/page"
import {
  getWalletOverview,
  listWalletBalances,
  getWalletLedger,
  listWalletTransactions,
  topUpWallet,
} from "@/lib/api/admin-billing"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      topUpCount: "{count} top-ups",
    }
    let message = messages[key] ?? key
    for (const [name, value] of Object.entries(values ?? {})) {
      message = message.replace(`{${name}}`, String(value))
    }
    return message
  },
  useFormatter: () => ({
    dateTime: () => "Jan 1, 2024",
    number: (value: number, opts?: { style?: string; currency?: string }) => {
      if (opts?.style === "currency") {
        return `EGP ${value}`
      }
      return String(value)
    },
  }),
}))

vi.mock("@/lib/api/admin-billing", () => ({
  getWalletOverview: vi.fn(),
  listWalletBalances: vi.fn(),
  getWalletLedger: vi.fn(),
  listWalletTransactions: vi.fn(),
  topUpWallet: vi.fn(),
}))

const overviewMock = vi.mocked(getWalletOverview)
const balancesMock = vi.mocked(listWalletBalances)
const ledgerMock = vi.mocked(getWalletLedger)
const transactionsMock = vi.mocked(listWalletTransactions)
const topUpMock = vi.mocked(topUpWallet)

function makeWallet(overrides: {
  accountId?: string
  ownerEmail?: string
  ownerFullName?: string | null
  status?: string
  balance?: number
} = {}) {
  const {
    accountId = "wallet-1",
    ownerEmail = "owner@example.com",
    ownerFullName = "Cairo Owner",
    status = "active",
    balance = 120,
  } = overrides
  return {
    accountId,
    ownerUserId: `user-${accountId}`,
    ownerEmail,
    ownerFullName,
    status,
    balance,
    lifetimeGranted: 500,
    lifetimeSpent: 380,
    createdAt: "2024-01-01T00:00:00.000Z",
  }
}

function makeLedgerRow(overrides: { direction?: string; reason?: string } = {}) {
  const { direction = "credit", reason = "topup" } = overrides
  return {
    id: `ledger-${direction}-${reason}`,
    direction,
    reason,
    metric: null,
    points: 120,
    balanceAfter: 500,
    claimKey: "claim-1",
    expiresAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
  }
}

function makeTransaction(overrides: { status?: string } = {}) {
  const { status = "succeeded" } = overrides
  return {
    id: "tx-1",
    accountId: "wallet-1",
    ownerEmail: "owner@example.com",
    ownerFullName: "Cairo Owner",
    provider: "fake",
    providerTransactionId: "pt-1",
    kind: "charge",
    status,
    amountEgp: 300,
    currency: "EGP",
    paymentMode: "card",
    occurredAt: "2024-01-01T00:00:00.000Z",
  }
}

describe("AdminRevenuePage", () => {
  beforeEach(() => {
    overviewMock.mockReset()
    balancesMock.mockReset()
    ledgerMock.mockReset()
    transactionsMock.mockReset()
    topUpMock.mockReset()
    overviewMock.mockResolvedValue({
      totalAccounts: 1,
      activeAccounts: 1,
      pausedAccounts: 0,
      totalPointsOutstanding: 120,
      totalLifetimeGranted: 500,
      totalLifetimeSpent: 380,
      totalTopUpEgp: 300,
      totalTopUpCount: 1,
      unverifiedUsers: 0,
    })
    balancesMock.mockResolvedValue({
      items: [makeWallet()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    ledgerMock.mockResolvedValue([])
    transactionsMock.mockResolvedValue({
      items: [makeTransaction()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    topUpMock.mockResolvedValue({ balance: 170, lifetimeGranted: 550 })
  })

  it("renders the revenue header, wallet stats, and tables", async () => {
    await waitFor(() => {
      render(<AdminRevenuePage />)
    })

    expect(await screen.findByText("revenueDescription")).toBeDefined()
    expect(screen.getAllByText("walletsTitle").length).toBeGreaterThan(0)
    expect(screen.getAllByText("owner@example.com").length).toBeGreaterThan(0)
    expect(screen.getAllByText("transactionsTitle").length).toBeGreaterThan(0)
    expect(screen.getAllByText("EGP 300").length).toBeGreaterThan(0)
    expect(screen.getAllByText("120").length).toBeGreaterThan(0)
  })

  it("shows no-wallets and no-transactions empty states", async () => {
    balancesMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    transactionsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    await waitFor(() => {
      render(<AdminRevenuePage />)
    })

    expect(await screen.findByText("noWallets")).toBeDefined()
    expect(screen.getByText("noTransactions")).toBeDefined()
  })

  it("loads and shows the ledger when a wallet is selected", async () => {
    ledgerMock.mockResolvedValue([makeLedgerRow()])

    await waitFor(() => {
      render(<AdminRevenuePage />)
    })

    const ownerCells = await screen.findAllByText("owner@example.com")
    fireEvent.click(ownerCells[0])

    expect(await screen.findByText("walletLedgerTitle")).toBeDefined()
    expect(screen.getByText("ledgerReasonTopup")).toBeDefined()
    expect(ledgerMock).toHaveBeenCalledWith("wallet-1")
  })

  it("opens a wallet ledger from the keyboard", async () => {
    ledgerMock.mockResolvedValue([makeLedgerRow()])

    render(<AdminRevenuePage />)

    const walletRow = await screen.findByRole("button", {
      name: "openWalletDetails",
    })
    fireEvent.keyDown(walletRow, { key: "Enter" })

    expect(await screen.findByText("walletLedgerTitle")).toBeDefined()
    expect(ledgerMock).toHaveBeenCalledWith("wallet-1")
  })

  it("shows a retryable state when the selected wallet ledger fails", async () => {
    ledgerMock.mockRejectedValueOnce(new Error("ledger unavailable"))

    render(<AdminRevenuePage />)

    const ownerCells = await screen.findAllByText("owner@example.com")
    fireEvent.click(ownerCells[0])

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("walletLedgerLoadError")
    expect(within(alert).getByRole("button", { name: "retry" })).toBeDefined()
  })

  it("renders a debit ledger row label", async () => {
    ledgerMock.mockResolvedValue([makeLedgerRow({ direction: "debit", reason: "spend" })])

    await waitFor(() => {
      render(<AdminRevenuePage />)
    })

    const ownerCells = await screen.findAllByText("owner@example.com")
    fireEvent.click(ownerCells[0])

    expect(await screen.findByText("ledgerReasonSpend")).toBeDefined()
    expect(screen.getByText("ledgerDebit")).toBeDefined()
  })

  it("renders a failed transaction status badge", async () => {
    transactionsMock.mockResolvedValue({
      items: [makeTransaction({ status: "failed" })],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    await waitFor(() => {
      render(<AdminRevenuePage />)
    })

    expect(await screen.findByText("transactionStatusFailed")).toBeDefined()
  })

  it("does not render the wallet status filter", async () => {
    render(<AdminRevenuePage />)

    expect(await screen.findByText("walletsTitle")).toBeDefined()
    expect(screen.queryByRole("group", { name: "walletStatus" })).toBeNull()
    expect(screen.queryByRole("button", { name: "walletStatusAll" })).toBeNull()
  })

  it("keeps the wallet search field mounted and focused while filtering", async () => {
    render(<AdminRevenuePage />)

    const search = await screen.findByLabelText("walletSearchLabel")
    search.focus()
    fireEvent.change(search, { target: { value: "owner" } })

    expect(screen.getByLabelText("walletSearchLabel")).toBe(search)
    expect(document.activeElement).toBe(search)

    await waitFor(() => {
      expect(balancesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "owner" }),
      )
    })
  })

  it("top-ups the selected wallet and refreshes the data", async () => {
    balancesMock.mockResolvedValueOnce({
      items: [makeWallet({ balance: 120 })],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    balancesMock.mockResolvedValueOnce({
      items: [makeWallet({ balance: 170 })],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    await waitFor(() => {
      render(<AdminRevenuePage />)
    })

    const ownerCells = await screen.findAllByText("owner@example.com")
    fireEvent.click(ownerCells[0])

    const topUpButton = await screen.findByRole("button", { name: "topUpWallet" })
    fireEvent.click(topUpButton)

    const pointsInput = await screen.findByLabelText("topUpPointsLabel")
    fireEvent.change(pointsInput, { target: { value: "50" } })
    const reasonInput = screen.getByLabelText("reasonLabel")
    fireEvent.change(reasonInput, { target: { value: "manual credit" } })

    const confirmButton = screen.getByRole("button", { name: "topUpWallet" })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(topUpMock).toHaveBeenCalledWith("wallet-1", 50, "manual credit")
    })
    expect(await screen.findByText("topUpWalletComplete")).toBeDefined()
    await waitFor(() => {
      expect(ledgerMock).toHaveBeenCalledWith("wallet-1")
    })
    await waitFor(() => {
      expect(screen.getByText("170")).toBeDefined()
    })
  })

  it("surfaces refresh failures after the initial dashboard load", async () => {
    balancesMock.mockResolvedValueOnce({
      items: [makeWallet()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    balancesMock.mockRejectedValueOnce(new Error("refresh unavailable"))

    render(<AdminRevenuePage />)

    const search = await screen.findByLabelText("walletSearchLabel")
    fireEvent.change(search, { target: { value: "missing" } })

    await waitFor(
      () => {
        expect(screen.getByRole("alert").textContent).toContain("refreshFailed")
      },
      { timeout: 2000 },
    )
  })

  it("disables the top-up confirm button until points and reason are valid", async () => {
    await waitFor(() => {
      render(<AdminRevenuePage />)
    })

    const ownerCells = await screen.findAllByText("owner@example.com")
    fireEvent.click(ownerCells[0])

    const topUpButton = await screen.findByRole("button", { name: "topUpWallet" })
    fireEvent.click(topUpButton)

    const confirmButton = screen.getByRole("button", { name: "topUpWallet" })
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true)

    const pointsInput = await screen.findByLabelText("topUpPointsLabel")
    fireEvent.change(pointsInput, { target: { value: "0" } })
    const reasonInput = screen.getByLabelText("reasonLabel")
    fireEvent.change(reasonInput, { target: { value: "manual credit" } })

    expect((confirmButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(pointsInput, { target: { value: "50" } })
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false)
  })
})
