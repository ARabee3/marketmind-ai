import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { screen } from "@testing-library/dom"
import { StatTile } from "../ui/stat-tile"
import { Badge } from "../ui/badge"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table"
import { Skeleton } from "../ui/skeleton"

const t = (key: string) => key

vi.mock("next-intl", () => ({
  useTranslations: () => t,
  useFormatter: () => ({
    dateTime: () => "Jan 1, 2024",
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
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn() }),
}))

describe("StatTile", () => {
  it("renders label, value, and optional subtext", () => {
    const { container } = render(
      <StatTile label="MRR" value="1,234" subtext="12 active" />,
    )
    expect(screen.getByText("MRR")).toBeDefined()
    expect(screen.getByText("1,234")).toBeDefined()
    expect(screen.getByText("12 active")).toBeDefined()
  })

  it("renders without subtext", () => {
    render(<StatTile label="Users" value="42" />)
    expect(screen.getByText("Users")).toBeDefined()
    expect(screen.getByText("42")).toBeDefined()
  })
})

describe("Badge", () => {
  it("renders children with default variant", () => {
    render(<Badge>ACTIVE</Badge>)
    expect(screen.getByText("ACTIVE")).toBeDefined()
  })

  it("applies variant class for admin", () => {
    const { container } = render(<Badge variant="admin">ADMIN</Badge>)
    const el = container.querySelector("span")
    expect(el?.className).toContain("bg-navy")
  })

  it("applies variant class for active", () => {
    const { container } = render(<Badge variant="active">active</Badge>)
    const el = container.querySelector("span")
    expect(el?.className).toContain("bg-primary")
  })
})

describe("Table", () => {
  it("renders a complete table with headers and rows", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alice</TableCell>
            <TableCell>alice@test.com</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(screen.getByText("Name")).toBeDefined()
    expect(screen.getByText("alice@test.com")).toBeDefined()
  })
})

describe("Skeleton", () => {
  it("renders a div with pulse animation", () => {
    const { container } = render(<Skeleton className="h-12 w-full" />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("animate-pulse")
  })
})
