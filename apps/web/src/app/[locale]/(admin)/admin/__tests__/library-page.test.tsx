import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import AdminLibraryPage from "../library/page"
import {
  approveKnowledgeLibraryEntry,
  listKnowledgeLibraryEntries,
  rejectKnowledgeLibraryEntry,
  triggerKnowledgeLibraryIngest,
} from "@/lib/api/knowledge-library-admin"

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
      libraryVersionsCount: "{count} version(s)",
      libraryReviewedBy: "Reviewed by {reviewer}",
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

vi.mock("@/lib/api/knowledge-library-admin", () => ({
  listKnowledgeLibraryEntries: vi.fn(),
  approveKnowledgeLibraryEntry: vi.fn(),
  rejectKnowledgeLibraryEntry: vi.fn(),
  triggerKnowledgeLibraryIngest: vi.fn(),
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

const listMock = vi.mocked(listKnowledgeLibraryEntries)
const approveMock = vi.mocked(approveKnowledgeLibraryEntry)
const rejectMock = vi.mocked(rejectKnowledgeLibraryEntry)
const ingestMock = vi.mocked(triggerKnowledgeLibraryIngest)

function makeEntry(overrides: {
  id?: string
  slug?: string
  title?: string
  kind?: string
  reviewStatus?: string
  reviewer?: string | null
  version?: number
} = {}) {
  const {
    id = "entry-1",
    slug = "benchmark/ramadan-cpc",
    title = "Ramadan CPC Benchmarks",
    kind = "benchmark_report",
    reviewStatus = "draft",
    reviewer = null,
    version = 3,
  } = overrides
  return {
    entry: {
      id,
      slug,
      latestVersion: version,
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    latest: {
      id: `version-${id}-${version}`,
      version,
      kind,
      title,
      summary: "Seasonal benchmarks for Ramadan campaigns.",
      locale: "en",
      reviewStatus,
      evidenceTier: "verified_benchmark",
      effectiveAt: "2024-01-01T00:00:00.000Z",
      expiresAt: null,
      reviewer,
      reviewedAt: reviewer ? "2024-01-02T00:00:00.000Z" : null,
    },
    versionCount: version,
  }
}

describe("AdminLibraryPage", () => {
  beforeEach(() => {
    listMock.mockReset()
    approveMock.mockReset()
    rejectMock.mockReset()
    ingestMock.mockReset()
    listMock.mockResolvedValue({
      items: [makeEntry()],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    approveMock.mockResolvedValue({ reviewStatus: "approved", version: 4 })
    rejectMock.mockResolvedValue({ reviewStatus: "retired", version: 4 })
    ingestMock.mockResolvedValue({
      id: "run-1",
      status: "pending",
      actor: "admin@example.com",
      startedAt: "2024-01-01T00:00:00.000Z",
    })
  })

  it("lists library entries by default", async () => {
    render(<AdminLibraryPage />)

    expect(await screen.findByText("Ramadan CPC Benchmarks")).toBeDefined()
    expect(listMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: undefined,
      status: undefined,
    })
  })

  it("shows an empty state when no entries match", async () => {
    listMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })

    render(<AdminLibraryPage />)

    expect(await screen.findByText("noLibraryEntries")).toBeDefined()
  })

  it("filters by review status", async () => {
    render(<AdminLibraryPage />)

    await screen.findByText("Ramadan CPC Benchmarks")
    fireEvent.click(screen.getByRole("button", { name: "approved" }))

    await waitFor(() => {
      expect(listMock).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        search: undefined,
        status: "approved",
      })
    })
  })

  it("approves a draft entry", async () => {
    render(<AdminLibraryPage />)

    await screen.findByText("Ramadan CPC Benchmarks")
    fireEvent.click(screen.getByRole("button", { name: "approveEntry" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("approveEntryTitle")).toBeDefined()
    fireEvent.click(within(dialog).getByRole("button", { name: "approveEntry" }))

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith("benchmark/ramadan-cpc")
    })
  })

  it("rejects a draft entry", async () => {
    render(<AdminLibraryPage />)

    await screen.findByText("Ramadan CPC Benchmarks")
    fireEvent.click(screen.getByRole("button", { name: "rejectEntry" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("rejectEntryTitle")).toBeDefined()
    fireEvent.click(
      within(dialog).getByRole("button", { name: "rejectEntry" }),
    )

    await waitFor(() => {
      expect(rejectMock).toHaveBeenCalledWith("benchmark/ramadan-cpc")
    })
  })

  it("does not offer review actions for approved entries", async () => {
    listMock.mockResolvedValue({
      items: [
        makeEntry({
          reviewStatus: "approved",
          reviewer: "admin@example.com",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    render(<AdminLibraryPage />)

    expect(await screen.findByText("Ramadan CPC Benchmarks")).toBeDefined()
    expect(screen.queryByRole("button", { name: "approveEntry" })).toBeNull()
    expect(screen.getByText("libraryNoReviewAction")).toBeDefined()
  })

  it("triggers a validated ingestion run", async () => {
    render(<AdminLibraryPage />)

    await screen.findByText("Ramadan CPC Benchmarks")
    fireEvent.click(screen.getByRole("button", { name: "triggerIngest" }))

    await waitFor(() => {
      expect(ingestMock).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText("ingestComplete")).toBeDefined()
  })

  it("refetches after an approval", async () => {
    render(<AdminLibraryPage />)

    await screen.findByText("Ramadan CPC Benchmarks")
    fireEvent.click(screen.getByRole("button", { name: "approveEntry" }))

    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "approveEntry" }))

    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(1)
    })
  })
})
