import { describe, it, expect, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import { screen } from "@testing-library/dom"
import {
  AdminPagination,
  getAdminTotalPages,
} from "../layout/admin-pagination"

const t = (key: string) => key

vi.mock("next-intl", () => ({
  useTranslations: () => t,
}))

describe("AdminPagination", () => {
  it("calculates pages from the total record count", () => {
    expect(getAdminTotalPages(0, 20)).toBe(1)
    expect(getAdminTotalPages(20, 20)).toBe(1)
    expect(getAdminTotalPages(21, 20)).toBe(2)
  })

  it("enables the next page and reports the current page", () => {
    const onPageChange = vi.fn()
    render(
      <AdminPagination
        page={1}
        total={21}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    )

    expect(screen.getByText("pageOfPages")).toBeDefined()
    expect(
      (screen.getByRole("button", { name: "previousPage" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    const next = screen.getByRole("button", { name: "nextPage" })
    expect((next as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(next)
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})
