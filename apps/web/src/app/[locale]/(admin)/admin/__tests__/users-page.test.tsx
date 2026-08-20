import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminUsersPage from "../users/page"
import { getAdminUser, getAdminUsers, updateAdminUser } from "@/lib/api/admin"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      pageOfPages: "Page {page} of {totalPages}",
      previous: "Previous",
      next: "Next",
      previousPage: "Previous page",
      nextPage: "Next page",
      paginationLabel: "Pagination",
      openUserDetails: "Open details for {name}",
      confirmSuspendTitle: "Suspend this account?",
      confirmSuspendDescription: "This immediately blocks {name}.",
      confirmReactivateTitle: "Reactivate this account?",
      confirmReactivateDescription: "This restores access for {name}.",
      cancel: "Cancel",
      reasonLabel: "Reason (visible in the audit log)",
      reasonPlaceholder: "e.g. policy violation",
      saved: "Saved. The change is recorded in the audit log.",
      suspend: "Suspend account",
      reactivate: "Reactivate account",
    }
    let message = messages[key] ?? key
    for (const [name, value] of Object.entries(values ?? {})) {
      message = message.replace(`{${name}}`, String(value))
    }
    return message
  },
  useFormatter: () => ({
    dateTime: () => "Jan 1, 2024",
    number: (value: number) => String(value),
  }),
}))

vi.mock("@/lib/api/admin", () => ({
  getAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
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

const getAdminUsersMock = vi.mocked(getAdminUsers)
const getAdminUserMock = vi.mocked(getAdminUser)
const updateAdminUserMock = vi.mocked(updateAdminUser)

function makeUser(page: number) {
  return {
    id: `user-${page}`,
    fullName: `User ${page}`,
    email: `user-${page}@example.com`,
    isEmailVerified: true,
    roles: ["OWNER"],
    loginMethod: "password",
    status: "active",
    createdAt: "2024-01-01T00:00:00.000Z",
    lastLoginAt: null,
    businessCount: 0,
    activeSessionCount: 0,
  }
}

describe("AdminUsersPage pagination", () => {
  beforeEach(() => {
    getAdminUsersMock.mockReset()
    vi.mocked(getAdminUser).mockReset()
    updateAdminUserMock.mockReset()
    updateAdminUserMock.mockResolvedValue({
      id: "user-1",
      email: "user-1@example.com",
      fullName: "User 1",
      roles: ["OWNER"],
      status: "suspended",
      isEmailVerified: true,
      lastLoginAt: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    })
    getAdminUsersMock.mockImplementation(async ({ page = 1, pageSize = 20 } = {}) => ({
      items: [makeUser(page)],
      total: 21,
      page,
      pageSize,
    }))
  })

  it("requests and renders the next page when Next is clicked", async () => {
    render(<AdminUsersPage />)

    expect(await screen.findByText("user-1@example.com")).toBeDefined()
    const next = screen.getByRole("button", { name: "Next page" })
    fireEvent.click(next)

    await waitFor(() => {
      expect(getAdminUsersMock).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 20,
        search: "",
      })
    })
    expect(await screen.findByText("user-2@example.com")).toBeDefined()
    expect(screen.getByText("Page 2 of 2")).toBeDefined()
  })

  it("filters users by account type and account status", async () => {
    render(<AdminUsersPage />)

    expect(await screen.findByText("user-1@example.com")).toBeDefined()

    fireEvent.change(screen.getByLabelText("accountTypeFilterLabel"), {
      target: { value: "ADMIN" },
    })
    fireEvent.change(screen.getByLabelText("accountStatusFilterLabel"), {
      target: { value: "SUSPENDED" },
    })

    await waitFor(() => {
      expect(getAdminUsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          role: "ADMIN",
          status: "SUSPENDED",
        }),
      )
    })
  })

  it("localizes the disabled account status label", async () => {
    getAdminUsersMock.mockResolvedValueOnce({
      items: [{ ...makeUser(1), status: "disabled" }],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    render(<AdminUsersPage />)

    expect(await screen.findByText("statusDisabled")).toBeDefined()
    expect(screen.queryByText("disabled")).toBeNull()
  })

  it("traps focus in user details and restores it to the opening row", async () => {
    getAdminUserMock.mockResolvedValue({
      user: {
        ...makeUser(1),
        isEmailVerified: true,
        loginMethod: "password",
      },
      federatedIdentities: [],
      activeSessions: [],
      businesses: [],
    })

    render(<AdminUsersPage />)

    const row = await screen.findByRole("button", {
      name: "Open details for User 1",
    })
    row.focus()
    fireEvent.click(row)

    const dialog = await screen.findByRole("dialog")
    const close = within(dialog).getByRole("button", { name: "close" })
    await waitFor(() => expect(document.activeElement).toBe(close))

    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(close)

    const lastFocusable = within(dialog).getByRole("button", {
      name: "saveRoles",
    })
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(lastFocusable)

    fireEvent.click(close)
    expect(document.activeElement).toBe(row)
  })
})

describe("AdminUsersPage account management", () => {
  beforeEach(() => {
    getAdminUsersMock.mockReset()
    getAdminUserMock.mockReset()
    updateAdminUserMock.mockReset()
    updateAdminUserMock.mockResolvedValue({
      id: "user-1",
      email: "user-1@example.com",
      fullName: "User 1",
      roles: ["OWNER"],
      status: "suspended",
      isEmailVerified: true,
      lastLoginAt: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    })
    getAdminUsersMock.mockResolvedValue({
      items: [makeUser(1)],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  })

  async function openPanel(userOverrides: Partial<ReturnType<typeof makeUser>> = {}) {
    getAdminUserMock.mockResolvedValue({
      user: {
        ...makeUser(1),
        ...userOverrides,
      },
      federatedIdentities: [],
      activeSessions: [],
      businesses: [],
    })

    render(<AdminUsersPage />)

    const row = await screen.findByRole("button", {
      name: "Open details for User 1",
    })
    fireEvent.click(row)
    return await screen.findByRole("dialog")
  }

  it("suspends an active user after confirming with a reason", async () => {
    const dialog = await openPanel({ status: "active" })

    const suspend = within(dialog).getByRole("button", { name: "Suspend account" })
    fireEvent.click(suspend)

    const alertDialog = await screen.findByRole("alertdialog")
    expect(
      within(alertDialog).getByText("Suspend this account?"),
    ).toBeDefined()

    fireEvent.change(
      within(alertDialog).getByLabelText("Reason (visible in the audit log)"),
      { target: { value: "fraud flag" } },
    )
    fireEvent.click(
      within(alertDialog).getByRole("button", { name: "Suspend account" }),
    )

    await waitFor(() => {
      expect(updateAdminUserMock).toHaveBeenCalledWith("user-1", {
        status: "SUSPENDED",
        reason: "fraud flag",
      })
    })
  })

  it("reactivates a suspended user after confirming", async () => {
    const dialog = await openPanel({ status: "suspended" })

    const reactivate = within(dialog).getByRole("button", {
      name: "Reactivate account",
    })
    fireEvent.click(reactivate)

    const alertDialog = await screen.findByRole("alertdialog")
    expect(
      within(alertDialog).getByText("Reactivate this account?"),
    ).toBeDefined()

    fireEvent.click(
      within(alertDialog).getByRole("button", { name: "Reactivate account" }),
    )

    await waitFor(() => {
      expect(updateAdminUserMock).toHaveBeenCalledWith("user-1", {
        status: "ACTIVE",
        reason: undefined,
      })
    })
  })

  it("saves the selected roles for a user", async () => {
    const dialog = await openPanel({ status: "active", roles: ["OWNER"] })

    fireEvent.click(
      within(dialog).getByRole("button", { name: "roleAdmin" }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "saveRoles" }))

    await waitFor(() => {
      expect(updateAdminUserMock).toHaveBeenCalledWith("user-1", {
        roles: ["OWNER", "ADMIN"],
      })
    })
  })
})
