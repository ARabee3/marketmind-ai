import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import AdminAuditPage from "../audit/page"
import { getAdminAudit } from "@/lib/api/admin"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      auditFiltersLabel: "Filter audit events",
      auditApply: "Apply",
      auditClearFilters: "Clear filters",
      auditFiltersActive: "Filters applied",
      auditActionFilter: "Action",
      auditActor: "Actor",
      auditFrom: "From",
      auditTo: "To",
      auditTime: "Time",
      auditAction: "Action",
      auditTargetType: "Target",
      auditTargetId: "Target ID",
      auditReason: "Reason",
      auditBefore: "Before",
      auditAfter: "After",
      noAuditLogs: "No audit events found",
      pageOfPages: "Page {page} of {totalPages}",
      previous: "Previous",
      next: "Next",
      previousPage: "Previous page",
      nextPage: "Next page",
      paginationLabel: "Pagination",
      auditStateNone: "—",
      loadError: "Could not load data. Try again.",
      retry: "Retry",
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

vi.mock("@/lib/api/admin", () => ({
  getAdminAudit: vi.fn(),
}))

const getAdminAuditMock = vi.mocked(getAdminAudit)

function makeAudit(id: string) {
  return {
    id,
    actorUserId: `actor-${id}`,
    actorEmail: `actor-${id}@example.com`,
    action: "user.suspend",
    targetType: "user",
    targetId: `target-${id}`,
    reason: "fraud review",
    beforeState: { status: "active" },
    afterState: { status: "suspended" },
    createdAt: "2024-01-01T00:00:00.000Z",
  }
}

describe("AdminAuditPage", () => {
  beforeEach(() => {
    getAdminAuditMock.mockReset()
    getAdminAuditMock.mockImplementation(async ({ page = 1, pageSize = 20 } = {}) => ({
      items: [makeAudit(String(page))],
      total: 1,
      page,
      pageSize,
    }))
  })

  it("renders the audit table with recorded event fields", async () => {
    render(<AdminAuditPage />)

    expect(await screen.findByText("user.suspend")).toBeDefined()
    expect(screen.getByText("actor-1@example.com")).toBeDefined()
    expect(screen.getByText("fraud review")).toBeDefined()
    expect(screen.getByText('{"status":"active"}')).toBeDefined()
    expect(screen.getByText('{"status":"suspended"}')).toBeDefined()
  })

  it("applies filters and refetches with the chosen criteria", async () => {
    render(<AdminAuditPage />)

    await screen.findByText("user.suspend")

    const actionInput = screen.getByLabelText("Action")
    fireEvent.change(actionInput, { target: { value: "user.role_change" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    await waitFor(() => {
      expect(getAdminAuditMock).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        action: "user.role_change",
        actor: undefined,
        from: undefined,
        to: undefined,
      })
    })
  })

  it("shows the empty state when there are no audit events", async () => {
    getAdminAuditMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })

    render(<AdminAuditPage />)

    expect(await screen.findByText("No audit events found")).toBeDefined()
  })
})