import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentWeekLedger } from "../content-week-ledger";
import { buildWeekSlots } from "../../lib/content-cycle-state";
import { mockOwnerConfirmedContextWeek1, mockQueuedPack, MOCK_CYCLE_ID } from "../../lib/content-cycle-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: Record<string, unknown>) => {
    if (key === "week") return `W${opts?.number}`;
    if (key === "ownerConfirmed") return "Confirmed by owner";
    if (key === "systemDefaulted") return "Safe default used";
    if (key === "contextOpen") return "Context open";
    if (key === "packHistoryUnavailable") return "History unavailable";
    if (key === "notEligibleYet") return "Planned";
    if (key === "current") return "Current";
    if (key === "next") return "Next";
    return key;
  },
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("ContentWeekLedger", () => {
  it("renders 12 week navigation links", () => {
    const slots = buildWeekSlots(MOCK_CYCLE_ID, 1, 1, [mockOwnerConfirmedContextWeek1], mockQueuedPack);
    render(<ContentWeekLedger slots={slots} />);

    const links = screen.getAllByRole("link");
    expect(links.length).toBe(12);
    expect(links[0]?.getAttribute("href")).toBe(`/content/${MOCK_CYCLE_ID}/weeks/1`);
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
  });

  it("displays distinct text for owner confirmed, current, and known pack status", () => {
    const slots = buildWeekSlots(MOCK_CYCLE_ID, 1, 1, [mockOwnerConfirmedContextWeek1], mockQueuedPack);
    render(<ContentWeekLedger slots={slots} />);

    expect(screen.getByText((content) => content.includes("Confirmed by owner"))).toBeDefined();
    expect(screen.getByText("Current")).toBeDefined();
    expect(screen.getByText("queued")).toBeDefined();
  });
});
