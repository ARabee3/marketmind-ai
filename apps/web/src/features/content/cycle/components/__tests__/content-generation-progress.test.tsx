import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContentGenerationProgress } from "../content-generation-progress";
import {
  mockFailedRetryablePack,
  mockDraftPack,
  mockPackProgressEvents,
  MOCK_PACK_ID,
} from "../../lib/content-cycle-fixtures";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: Record<string, unknown>) => {
    if (key === "statuses.failed") return "Generation stopped";
    if (key === "statuses.draft") return "Draft pack ready";
    if (key === "stages.queued") return "Queued for generation";
    if (key === "stages.generating") return "Generating draft items";
    if (key === "retryGeneration") return "Retry Generation";
    if (key === "reviewPack") return "Review Draft Pack";
    if (key === "itemCount") return `${opts?.count} draft items`;
    return key;
  },
  useLocale: () => "en",
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("ContentGenerationProgress", () => {
  it("renders retry action for retryable failed pack", () => {
    const onRetry = vi.fn();
    render(
      <ContentGenerationProgress
        pack={mockFailedRetryablePack}
        events={mockPackProgressEvents}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Generation stopped")).toBeDefined();
    expect(screen.getByText("Retry Generation")).toBeDefined();
  });

  it("renders review pack link targeting /content/packs/:packId for draft pack", () => {
    render(
      <ContentGenerationProgress
        pack={mockDraftPack}
        events={mockPackProgressEvents}
        reviewRouteAvailable
      />,
    );

    expect(screen.getAllByText("Draft pack ready").length).toBeGreaterThan(0);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(`/content/packs/${MOCK_PACK_ID}`);
  });

  it("hides the review link until the companion review route is available", () => {
    render(
      <ContentGenerationProgress
        pack={mockDraftPack}
        events={mockPackProgressEvents}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });
});
