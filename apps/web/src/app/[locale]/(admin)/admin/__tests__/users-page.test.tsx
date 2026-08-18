import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminUsersPage from "../users/page"
import { getAdminUser, getAdminUsers } from "@/lib/api/admin"

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
  getAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
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
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(close)

    fireEvent.click(close)
    expect(document.activeElement).toBe(row)
  })
})
