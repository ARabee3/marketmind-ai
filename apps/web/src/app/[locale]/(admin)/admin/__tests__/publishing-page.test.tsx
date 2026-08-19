import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminPublishingPage from "../publishing/page"
import {
  listPublishingAdminResults,
  resolvePublishingAdminResult,
  triggerPublishingAdminSweep,
} from "@/lib/api/publishing-admin"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      pageOfPages: "Page {page} of {totalPages}",
      previous: "Previous",
      next: "Next",
      previousPage: "Previous page",
      nextPage: "Next page",
      paginationLabel: "Pagination",
      attemptNumber: "Attempt {number}",
      resolveResultDescription: "Mark this attempt as published or failed.",
      remotePublicationIdRequired: "A provider ID is required.",
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

vi.mock("@/lib/api/publishing-admin", () => ({
  listPublishingAdminResults: vi.fn(),
  resolvePublishingAdminResult: vi.fn(),
  resyncPublishingAdminIntent: vi.fn(),
  triggerPublishingAdminSweep: vi.fn(),
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

const listMock = vi.mocked(listPublishingAdminResults)
const resolveMock = vi.mocked(resolvePublishingAdminResult)
const sweepMock = vi.mocked(triggerPublishingAdminSweep)

function makeResult(overrides: {
  id?: string
  outcome?: string
  intentStatus?: string
} = {}) {
  const { id = "result-1", outcome = "UNKNOWN", intentStatus = "ACTION_REQUIRED" } =
    overrides
  return {
    id,
    outcome,
    provider: "meta",
    remotePublicationId: null,
    remoteUrl: null,
    errorCode: null,
    retryable: false,
    sanitizedError: null,
    occurredAt: "2024-01-01T00:00:00.000Z",
    createdAt: "2024-01-01T00:00:00.000Z",
    attempt: {
      id: `attempt-${id}`,
      status: "UNKNOWN",
      attemptSequence: 1,
      sanitizedError: null,
      startedAt: null,
      finishedAt: null,
    },
    intent: {
      id: `intent-${id}`,
      status: intentStatus,
      mode: "REAL",
      scheduledUtcAt: "2024-01-02T00:00:00.000Z",
      version: 1,
      businessId: "business-1",
      business: { id: "business-1", displayName: "Cairo Bakery" },
      candidate: {
        id: `candidate-${id}`,
        channel: "facebook",
        format: "static_image",
        locale: "ar",
      },
      target: {
        id: `target-${id}`,
        provider: "meta",
        channel: "facebook",
        displayName: "Cairo Bakery Page",
      },
    },
  }
}

describe("AdminPublishingPage", () => {
  beforeEach(() => {
    listMock.mockReset()
    resolveMock.mockReset()
    sweepMock.mockReset()
    listMock.mockResolvedValue({
      items: [makeResult()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    resolveMock.mockResolvedValue(makeResult({ outcome: "FAILED" }))
    sweepMock.mockResolvedValue({ ok: true, message: "ok" })
  })

  it("lists UNKNOWN results by default", async () => {
    render(<AdminPublishingPage />)

    expect(await screen.findByText("Cairo Bakery")).toBeDefined()
    expect(await screen.findByText("Cairo Bakery Page")).toBeDefined()
    expect(listMock).toHaveBeenCalledWith({
      outcome: "UNKNOWN",
      page: 1,
      pageSize: 20,
    })
  })

  it("shows an empty state when no results match", async () => {
    listMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    render(<AdminPublishingPage />)

    expect(await screen.findByText("noPublishingResults")).toBeDefined()
  })

  it("switches the outcome filter", async () => {
    render(<AdminPublishingPage />)

    await screen.findByText("Cairo Bakery")
    fireEvent.click(
      screen.getByRole("button", { name: "outcomePublished" }),
    )

    await waitFor(() => {
      expect(listMock).toHaveBeenLastCalledWith({
        outcome: "PUBLISHED",
        page: 1,
        pageSize: 20,
      })
    })
  })

  it("runs the reconciliation sweep", async () => {
    render(<AdminPublishingPage />)

    await screen.findByText("Cairo Bakery")
    fireEvent.click(screen.getByRole("button", { name: "runSweep" }))

    await waitFor(() => {
      expect(sweepMock).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText("sweepComplete")).toBeDefined()
  })

  it("resolves an UNKNOWN result as FAILED with a reason", async () => {
    render(<AdminPublishingPage />)

    await screen.findByText("Cairo Bakery")
    const row = screen.getByRole("button", { name: "resolve" })
    fireEvent.click(row)

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("resolveResultTitle")).toBeDefined()

    fireEvent.change(
      within(dialog).getByLabelText("reasonLabel"),
      { target: { value: "manual reconciliation" } },
    )
    fireEvent.click(
      within(dialog).getByRole("button", { name: "resolutionFailed" }),
    )
    fireEvent.click(
      within(dialog).getByRole("button", { name: "resolve" }),
    )

    await waitFor(() => {
      expect(resolveMock).toHaveBeenCalledWith("result-1", {
        resolution: "FAILED",
        reason: "manual reconciliation",
        remotePublicationId: undefined,
      })
    })
  })

  it("requires provider proof when resolving as PUBLISHED", async () => {
    render(<AdminPublishingPage />)

    await screen.findByText("Cairo Bakery")
    fireEvent.click(screen.getByRole("button", { name: "resolve" }))

    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(
      within(dialog).getByLabelText("reasonLabel"),
      { target: { value: "confirmed on dashboard" } },
    )
    fireEvent.click(
      within(dialog).getByRole("button", { name: "resolutionPublished" }),
    )

    const confirm = within(dialog).getByRole("button", { name: "resolve" })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(
      within(dialog).getByLabelText("remotePublicationIdLabel"),
      { target: { value: "page-1_post-2" } },
    )
    expect((confirm as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(confirm)

    await waitFor(() => {
      expect(resolveMock).toHaveBeenCalledWith("result-1", {
        resolution: "PUBLISHED",
        reason: "confirmed on dashboard",
        remotePublicationId: "page-1_post-2",
      })
    })
  })

  it("refetches after a resolution", async () => {
    render(<AdminPublishingPage />)

    await screen.findByText("Cairo Bakery")
    fireEvent.click(screen.getByRole("button", { name: "resolve" }))

    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(
      within(dialog).getByLabelText("reasonLabel"),
      { target: { value: "manual" } },
    )
    fireEvent.click(
      within(dialog).getByRole("button", { name: "resolutionFailed" }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "resolve" }))

    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(1)
    })
  })
})