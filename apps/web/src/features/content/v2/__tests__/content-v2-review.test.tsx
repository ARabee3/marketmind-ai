import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  ContentDecision,
  ContentItemVersionV2,
  ContentPackWorkspaceV2,
} from "@marketmind/contracts";
import { ContentPackReviewGate } from "../content-pack-review-gate";
import { ContentV2ReviewWorkspace } from "../content-v2-review";
import * as contentCycleApi from "@/lib/api/content-cycle";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      title: "Review drafts",
      loading: "Loading…",
      postTitle: "Post",
      historySection: "Version history",
      editInlineCta: "Edit caption",
      rewriteCta: "AI rewrite",
      approveCta: "Approve",
      copySection: "Caption and copy",
      ctaTag: "CTA",
      altText: "Alt text",
      timing: "Recommended window",
      backToStudio: "Back to the weekly studio",
      "decision.approved": "Approved",
      "editKind.generated": "Generated",
      "editKind.owner_direct_edit": "Owner edit",
      "editKind.ai_rewrite": "AI rewrite",
    };
    const template = map[key] ?? key;
    return values
      ? template.replace(/\{(\w+)\}/g, (_, name: string) =>
          String(values[name] ?? `{${name}}`),
        )
      : template;
  },
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api/content-cycle");
vi.mock("@/lib/api/content-v2", () => ({
  getPackWorkspaceV2: vi.fn(),
  directEditV2: vi.fn(),
  rewriteItemV2: vi.fn(),
}));
vi.mock("@/lib/api/content-review", () => ({
  submitItemDecision: vi.fn(),
}));
vi.mock("@/lib/api/publishing", () => ({
  createIdempotencyKey: () => "key-1",
}));

const VERSION: ContentItemVersionV2 = {
  id: "ver-2",
  contract_version: "content-v2",
  content_item_id: "item-1",
  content_pack_id: "pack-1",
  version: 2,
  channel: "instagram",
  format: "static_image_post",
  language_mode: "ar-EG",
  strategy_trace: {
    strategy_id: "strat-1",
    strategy_version: 1,
    week_number: 1,
    pillar_ids: [],
    objective: "awareness",
    channel: "instagram",
    funnel_stage: "awareness",
    content_purpose: "purpose",
  },
  caption_variants: [
    {
      locale: "ar",
      dialect: "masry",
      caption: "جرب الكشري اليوم",
      cta: null,
      hashtags: [],
    },
  ],
  cta: null,
  hashtags: [],
  creative_brief: "brief",
  alt_text: "صورة كشري",
  short_video_script: null,
  recommended_publish_window: {
    starts_at: "2026-08-08T12:00:00+03:00",
    ends_at: "2026-08-08T14:00:00+03:00",
    timezone: "Africa/Cairo",
    day_preference: "weekday",
    time_of_day_hint: "any",
    rationale: "",
  },
  claim_sources: [],
  warnings: [],
  blockers: [],
  asset_required: false,
  asset_ids: [],
  generation_provenance: {
    generation_run_id: "run-1",
    provider_name: "mock",
    provider_model: "mock",
    generated_at: "2026-08-02T12:00:00+03:00",
  },
  version_checksum: "a".repeat(64),
  created_at: "2026-08-02T12:00:00+03:00",
  edit_metadata: {
    edit_kind: "generated",
    base_version_id: null,
    base_version_checksum: null,
    edited_by_user_id: null,
    validation_state: "validated",
    edited_at: "2026-08-02T12:00:00+03:00",
  },
};

const DECISION: ContentDecision = {
  id: "dec-1",
  content_item_id: "item-1",
  content_item_version_id: "ver-2",
  content_item_version: 2,
  content_item_version_checksum: "a".repeat(64),
  decision: "approved",
  revision_notes: null,
  decided_by_user_id: "owner-1",
  decided_at: "2026-08-02T13:00:00+03:00",
};

const WORKSPACE: ContentPackWorkspaceV2 = {
  contract_version: "content-v2",
  pack: {
    id: "pack-1",
    contract_version: "content-v2",
    content_cycle_id: "cycle-1",
    weekly_claim_id: "claim-1",
    week_number: 1,
    business_id: "biz-1",
    strategy_id: "strat-1",
    strategy_version: 1,
    strategy_decision_id: "decision-1",
    profile_version_id: "prof-1",
    week_context_id: "ctx-1",
    status: "draft",
    retry_eligible: false,
    item_ids: ["item-1"],
    week_plan_id: "week-plan-1",
    created_at: "2026-08-02T12:00:00+03:00",
    updated_at: "2026-08-02T12:00:00+03:00",
  },
  week_number: 1,
  week_start_date: "2026-07-06",
  editorial_profile: null,
  items: [
    {
      content_item_id: "item-1",
      plan: null,
      current_version: VERSION,
      versions: [VERSION],
      decision: null,
    },
  ],
  publication_candidate: null,
};

describe("ContentPackReviewGate", () => {
  it("routes v2 packs to the v2 review workspace", async () => {
    vi.mocked(contentCycleApi.getContentPack).mockResolvedValue({
      contract_version: "content-v2",
      id: "pack-1",
    } as never);
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockResolvedValue(WORKSPACE);

    render(<ContentPackReviewGate packId="pack-1" />);
    expect(await screen.findByText("Review drafts")).toBeTruthy();
    expect(await screen.findByText("جرب الكشري اليوم")).toBeTruthy();
  });

  it("routes v1 packs to the legacy workspace", async () => {
    vi.mocked(contentCycleApi.getContentPack).mockResolvedValue({
      contract_version: "content-v1",
      id: "pack-1",
    } as never);
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockRejectedValue(new Error("not used"));

    render(<ContentPackReviewGate packId="pack-1" />);
    // The legacy workspace must render — never the v2 aggregate review.
    expect(screen.queryByText("جرب الكشري اليوم")).toBeNull();
    expect(screen.queryByText("Review drafts")).toBeNull();
  });
});

describe("ContentV2ReviewWorkspace", () => {
  it("renders the caption, version history, and approval action from real aggregate data", async () => {
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockResolvedValue(WORKSPACE);
    const { submitItemDecision } = await import("@/lib/api/content-review");
    vi.mocked(submitItemDecision).mockResolvedValue({
      decision: { decision: "approved", id: "dec-1" },
      publication_candidate: null,
    } as never);

    render(<ContentV2ReviewWorkspace packId="pack-1" />);

    expect(await screen.findByText("جرب الكشري اليوم")).toBeTruthy();
    expect(screen.getByText("Version history")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });
});
