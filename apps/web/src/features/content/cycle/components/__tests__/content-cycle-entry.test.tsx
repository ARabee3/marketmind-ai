import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContentCycleEntry } from "../content-cycle-entry";
import * as journeyApi from "@/lib/api/journey";
import * as strategyApi from "@/lib/api/strategy";
import * as contentCycleApi from "@/lib/api/content-cycle";
import type { CurrentJourneyResponse } from "@marketmind/contracts";
import {
  mockJourneyNoCycle,
  mockApprovedStrategyApiV2,
  mockStrategyVersions,
  mockActiveCycle,
  mockOwnerConfirmedContextWeek1,
  MOCK_STRATEGY_ID,
  MOCK_DECISION_ID,
  MOCK_STRATEGY_VERSION_ID,
} from "../../lib/content-cycle-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === "ContentCycle.entry") {
      if (key === "title") return "Turn the approved Strategy into weekly drafts";
      if (key === "noProfileTitle") return "Business Profile Required";
      if (key === "noStrategyTitle") return "Approved Strategy Required";
      if (key === "approvalRequiredTitle") return "Strategy Approval Needed";
      return key;
    }
    if (namespace === "ContentV2.entry") {
      if (key === "title") return "Your weekly content studio";
      if (key === "startCta") return "Start 12-Week Content Cycle";
      if (key === "strategyLabel") return "Approved strategy";
      if (key === "whatNextLabel") return "What happens next";
      if (key === "viewStrategyCta") return "View strategy";
      if (key === "formats.photo") return "Photo";
      if (key === "formats.reels") return "Reels";
      return key;
    }
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

  it("renders the content-v2 start screen when approved strategy passes all checks", async () => {
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
      mockApprovedStrategyApiV2,
    );
    vi.mocked(strategyApi.getStrategyVersions).mockResolvedValue(
      mockStrategyVersions,
    );

    render(<ContentCycleEntry />);

    await waitFor(() => {
      expect(screen.getByText("Your weekly content studio")).toBeDefined();
    });
    expect(screen.getByText("Reels · Photo")).toBeDefined();

    // The legacy oversized week-1 context form must not render.
    expect(screen.queryByRole("radio", { name: "noPromotion" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens the content-v2 studio after creating a cycle with a safe-default week context", async () => {
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
      mockApprovedStrategyApiV2,
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
      expect(screen.getByText("Your weekly content studio")).toBeDefined();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Start 12-Week Content Cycle" }),
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        `/content/${mockActiveCycle.id}/studio`,
      );
    });

    const createCall = vi.mocked(contentCycleApi.createContentCycle).mock
      .calls[0][0] as { initial_week_context: { promotion_mode: string } };
    expect(createCall.initial_week_context.promotion_mode).toBe("none");
  });

  it("never routes a legacy cycle to the V1 week workspace", async () => {
    vi.mocked(journeyApi.getCurrentJourney).mockResolvedValue({
      ...mockJourneyNoCycle,
      content: {
        ...mockJourneyNoCycle.content,
        cycle: { id: mockActiveCycle.id, current_week: 1 },
      },
    } as unknown as CurrentJourneyResponse);
    vi.mocked(contentCycleApi.getContentCycle).mockResolvedValue(
      mockActiveCycle,
    );

    render(<ContentCycleEntry />);

    await waitFor(() => {
      expect(screen.getByText("contentV2Required")).toBeDefined();
    });
    expect(mockReplace).not.toHaveBeenCalledWith(
      `/content/${mockActiveCycle.id}/weeks/1`,
    );
  });
});
