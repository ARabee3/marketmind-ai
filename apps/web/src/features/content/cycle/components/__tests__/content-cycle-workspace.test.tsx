import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ContentCycleWorkspace } from "../content-cycle-workspace";
import * as journeyApi from "@/lib/api/journey";
import * as strategyApi from "@/lib/api/strategy";
import * as contentCycleApi from "@/lib/api/content-cycle";
import {
  mockJourneyNoCycle,
  mockActiveCycle,
  mockOwnerConfirmedContextWeek1,
  MOCK_CYCLE_ID,
} from "../../lib/content-cycle-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "cycleUnavailableTitle") return "Content Cycle Unavailable";
    if (key === "cycleUnavailableBody")
      return "The strategy behind this cycle is no longer available, so the cycle cannot be opened.";
    if (key === "cycleUnavailableAction") return "Go to Content";
    if (key === "loading") return "Loading content workspace…";
    if (key === "notFound") return "Requested cycle or pack was not found.";
    if (key === "unavailable") return "Service temporarily unavailable. Please try again.";
    return key;
  },
  useLocale: () => "en",
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/journey");
vi.mock("@/lib/api/strategy");
vi.mock("@/lib/api/content-cycle");

const notFoundError = { status: 404, code: "NOT_FOUND", message: "Strategy not found" };

describe("ContentCycleWorkspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(journeyApi.getCurrentJourney).mockResolvedValue(mockJourneyNoCycle);
    vi.mocked(contentCycleApi.getContentCycle).mockResolvedValue(mockActiveCycle);
    vi.mocked(contentCycleApi.listContentWeeks).mockResolvedValue({
      weeks: [mockOwnerConfirmedContextWeek1],
    });
  });

  it("shows the recovery state when the cycle's strategy no longer exists", async () => {
    vi.mocked(strategyApi.getStrategy).mockRejectedValue(notFoundError);
    vi.mocked(strategyApi.getStrategyVersions).mockRejectedValue(notFoundError);
    vi.mocked(strategyApi.getStrategyVersion).mockRejectedValue(notFoundError);

    render(<ContentCycleWorkspace cycleId={MOCK_CYCLE_ID} weekNumber={1} />);

    await waitFor(() => {
      expect(screen.getByText("Content Cycle Unavailable")).toBeDefined();
    });
    expect(screen.getByRole("link", { name: "Go to Content" }).getAttribute("href")).toBe(
      "/content",
    );
  });

  it("does not mask non-404 strategy failures as unavailable", async () => {
    vi.mocked(strategyApi.getStrategy).mockRejectedValue({
      status: 500,
      code: "SERVER_ERROR",
      message: "boom",
    });
    vi.mocked(strategyApi.getStrategyVersions).mockRejectedValue({
      status: 500,
      code: "SERVER_ERROR",
      message: "boom",
    });
    vi.mocked(strategyApi.getStrategyVersion).mockRejectedValue({
      status: 500,
      code: "SERVER_ERROR",
      message: "boom",
    });

    render(<ContentCycleWorkspace cycleId={MOCK_CYCLE_ID} weekNumber={1} />);

    await waitFor(() => {
      expect(
        screen.getByText("Service temporarily unavailable. Please try again."),
      ).toBeDefined();
    });
    expect(screen.queryByText("Content Cycle Unavailable")).toBeNull();
    expect(screen.queryByRole("link", { name: "Go to Content" })).toBeNull();
  });
});
