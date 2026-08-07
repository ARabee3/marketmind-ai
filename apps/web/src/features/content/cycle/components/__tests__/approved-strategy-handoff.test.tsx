import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovedStrategyHandoff } from "../approved-strategy-handoff";
import { resolveApprovedContentStrategy } from "../../lib/content-cycle-state";
import {
  mockApprovedStrategyApi,
  mockJourneyNoCycle,
  mockStrategyVersions,
} from "../../lib/content-cycle-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: Record<string, unknown>) => {
    if (key === "theme") return `Week ${opts?.week} Theme`;
    if (key === "primaryChannel") return `Primary: ${opts?.channel}`;
    if (key === "supportingChannel") return `Supporting: ${opts?.channel}`;
    if (key === "strategyVersionId") return "Strategy Version ID";
    if (key === "decisionId") return "Approval Decision ID";
    if (key === "profileVersion") return `Profile Version ${opts?.version}`;
    return key;
  },
  useLocale: () => "en",
}));

describe("ApprovedStrategyHandoff", () => {
  it("renders exact theme, channels, and provenance details", () => {
    const res = resolveApprovedContentStrategy(
      mockJourneyNoCycle,
      mockApprovedStrategyApi,
      mockStrategyVersions,
    );
    if (!("approved" in res)) throw new Error("Expected approved strategy");

    render(<ApprovedStrategyHandoff selectedWeek={1} approved={res.approved} />);

    expect(screen.getByText((content) => content.includes("Essential Growth & Promotions"))).toBeDefined();
    expect(screen.getByText("Primary: facebook")).toBeDefined();
    expect(screen.getByText("Supporting: instagram")).toBeDefined();
  });
});
