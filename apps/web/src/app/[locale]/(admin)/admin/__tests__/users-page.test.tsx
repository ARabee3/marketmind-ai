import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

const getAdminUsersMock = vi.mocked(getAdminUsers)

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
})
