import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContentCycleEntry } from "../content-cycle-entry";
import * as journeyApi from "@/lib/api/journey";
import * as strategyApi from "@/lib/api/strategy";
import * as contentCycleApi from "@/lib/api/content-cycle";
import type { CurrentJourneyResponse } from "@marketmind/contracts";
import {
  mockJourneyNoCycle,
  mockApprovedStrategyApi,
  mockStrategyVersions,
  mockActiveCycle,
  mockOwnerConfirmedContextWeek1,
  MOCK_STRATEGY_ID,
  MOCK_DECISION_ID,
  MOCK_STRATEGY_VERSION_ID,
} from "../../lib/content-cycle-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "title") return "Turn the approved Strategy into weekly drafts";
    if (key === "noProfileTitle") return "Business Profile Required";
    if (key === "noStrategyTitle") return "Approved Strategy Required";
    if (key === "approvalRequiredTitle") return "Strategy Approval Needed";
    if (key === "startCycle") return "Start 12-Week Content Cycle";
    return key;
  },
  useLocale: () => "en",
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

const mockReplace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/journey");
vi.mock("@/lib/api/strategy");
vi.mock("@/lib/api/content-cycle");

describe("ContentCycleEntry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders blocker screen when no confirmed profile exists in journey", async () => {
    vi.mocked(journeyApi.getCurrentJourney).mockResolvedValue({
      ...mockJourneyNoCycle,
      future_phase: {
        phase: "strategy",
        availability: "locked",
        status: "needs_brief",
        reason: "discovery_required",
        destination: null,
      },
      journey: {
        state: "no_journey",
        discovery: null,
        profile: null,
      },
    });

    render(<ContentCycleEntry />);

    await waitFor(() => {
      expect(screen.getByText("Business Profile Required")).toBeDefined();
    });
  });

  it("renders ready to start workspace when approved strategy passes all checks", async () => {
    const journeyWithStrategy = {
      ...mockJourneyNoCycle,
      journey: {
        ...mockJourneyNoCycle.journey,
        strategy: {
          id: MOCK_STRATEGY_ID,
          status: "approved" as const,
        },
        strategy_decision: {
          decision: "approved" as const,
          decision_id: MOCK_DECISION_ID,
          approved_version_id: MOCK_STRATEGY_VERSION_ID,
        },
      },
    };

    vi.mocked(journeyApi.getCurrentJourney).mockResolvedValue(
      journeyWithStrategy as unknown as CurrentJourneyResponse,
    );
    vi.mocked(strategyApi.getStrategy).mockResolvedValue(
      mockApprovedStrategyApi,
    );
    vi.mocked(strategyApi.getStrategyVersions).mockResolvedValue(
      mockStrategyVersions,
    );

    render(<ContentCycleEntry />);

    await waitFor(() => {
      expect(
        screen.getAllByText((content) =>
          content.includes("Turn the approved Strategy"),
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  it("opens the content-v2 studio after creating a cycle", async () => {
    const journeyWithStrategy = {
      ...mockJourneyNoCycle,
      journey: {
        ...mockJourneyNoCycle.journey,
        strategy: {
          id: MOCK_STRATEGY_ID,
          status: "approved" as const,
        },
        strategy_decision: {
          decision: "approved" as const,
          decision_id: MOCK_DECISION_ID,
          approved_version_id: MOCK_STRATEGY_VERSION_ID,
        },
      },
    };

    vi.mocked(journeyApi.getCurrentJourney).mockResolvedValue(
      journeyWithStrategy as unknown as CurrentJourneyResponse,
    );
    vi.mocked(strategyApi.getStrategy).mockResolvedValue(
      mockApprovedStrategyApi,
    );
    vi.mocked(strategyApi.getStrategyVersions).mockResolvedValue(
      mockStrategyVersions,
    );
    vi.mocked(contentCycleApi.createContentCycle).mockResolvedValue({
      content_cycle: {
        ...mockActiveCycle,
        contract_version: "content-v2",
      },
      initial_week_context: {
        ...mockOwnerConfirmedContextWeek1,
        contract_version: "content-v1",
      },
    } as never);

    render(<ContentCycleEntry />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "noPromotion" })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("radio", { name: "noPromotion" }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "none" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Start 12-Week Content Cycle" }),
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        `/content/${mockActiveCycle.id}/studio`,
      );
    });
  });
});
