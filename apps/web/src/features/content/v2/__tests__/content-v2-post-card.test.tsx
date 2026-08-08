import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContentPostPlanV2 } from "@marketmind/contracts";
import { ContentV2PostCard } from "../content-v2-post-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      postLabel: "Post {position}",
      audienceLabel: "Intended audience",
      channelLabel: "Channel",
      formatLabel: "Format",
      ctaLabel: "Primary CTA",
      noCta: "No CTA",
      mediaLabel: "Selected media",
      visualLabel: "Visual direction",
      editCta: "Edit card",
      planned: "Planned",
    };
    const template = map[key] ?? key;
    return values
      ? template.replace(/\{(\w+)\}/g, (_, name: string) =>
          String(values[name] ?? `{${name}}`),
        )
      : template;
  },
}));

const PLAN: ContentPostPlanV2 = {
  id: "plan-1",
  contract_version: "content-v2",
  content_week_plan_id: "week-plan-1",
  position: 1,
  purpose: "تقديم طبق الكشري لموظفي المكاتب",
  intended_audience: "موظفو المكاتب القريبة",
  channel: "instagram",
  format: "static_image_post",
  cta_library_entry_id: null,
  owner_instructions: null,
  visual_direction: "صورة كشري طازج",
  selected_media_ids: ["media-1"],
  plan_state: "planned",
  source: "planner",
  content_item_id: null,
  created_at: "2026-08-02T11:00:00+03:00",
  updated_at: "2026-08-02T11:00:00+03:00",
};

describe("ContentV2PostCard", () => {
  it("renders the plan purpose, channel, format, and CTA", () => {
    render(<ContentV2PostCard plan={PLAN} ctaLabel={null} mediaCount={1} />);

    expect(screen.getByText("تقديم طبق الكشري لموظفي المكاتب")).toBeTruthy();
    expect(screen.getByText("Instagram")).toBeTruthy();
    expect(screen.getByText("Static image post")).toBeTruthy();
    expect(screen.getByText("No CTA")).toBeTruthy();
  });

  it("shows the selected CTA label when provided", () => {
    render(
      <ContentV2PostCard
        plan={PLAN}
        ctaLabel="اطلب بالواتساب"
        mediaCount={1}
      />,
    );
    expect(screen.getByText("اطلب بالواتساب")).toBeTruthy();
  });

  it("renders the edit action only when a handler is provided", () => {
    const { rerender } = render(
      <ContentV2PostCard plan={PLAN} ctaLabel={null} mediaCount={1} />,
    );
    expect(screen.queryByRole("button", { name: "Edit card" })).toBeNull();

    rerender(
      <ContentV2PostCard
        plan={PLAN}
        ctaLabel={null}
        mediaCount={1}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit card" })).toBeTruthy();
  });

  it("announces the card via an accessible name", () => {
    render(<ContentV2PostCard plan={PLAN} ctaLabel={null} mediaCount={1} />);
    const article = screen.getByRole("article");
    expect(article.getAttribute("aria-label")).toBe("Post 1");
  });
});
