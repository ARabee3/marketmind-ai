import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
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
      approvedTitle: "Approved posts",
      packApproved: "Approved",
      approvedReadOnlyTitle: "This pack is approved",
      approvedReadOnlyBody: "These posts are frozen.",
      approvedItemReadOnly: "Approved and locked.",
      loading: "Loading…",
      postTitle: "Post",
      historySection: "Version history",
      historySectionWithCount: "Edit history ({count})",
      editInlineCta: "Edit caption",
      rewriteCta: "AI rewrite",
      approveCta: "Approve",
      copySection: "Caption and copy",
      ctaTag: "CTA",
      altText: "Alt text",
      timing: "Recommended window",
      backToStudio: "Back to the weekly studio",
      legacyCycle: "Legacy Content V1 pack is outside the active workflow.",
      backToContent: "Go to Content",
      "decision.approved": "Approved",
      "editKind.generated": "Generated",
      "editKind.owner_direct_edit": "Owner edit",
      "editKind.ai_rewrite": "AI rewrite",
      generatedMedia: "Generated visual",
      uploadedMedia: "Uploaded image",
      mediaDimensionsUnknown: "Dimensions unavailable",
      mediaOptionLabel: "{kind}, {dimensions}",
      optionLabel: "{kind}, {dimensions}",
      dimensionsUnknown: "Dimensions unavailable",
      selected: "Selected",
      mediaSelected: "Selected",
      mediaChoose: "Choose from library",
      mediaSection: "Post visual",
      mediaRequired: "Photo required",
      mediaOptional: "Photo optional",
      mediaOptionalHelp: "No photo is required.",
      conflict: "This draft changed. Refreshing…",
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
  attachMediaV2: vi.fn(),
  generateMediaV2: vi.fn(),
  getMediaFileV2: vi.fn().mockResolvedValue(new Blob()),
  uploadMediaV2: vi.fn(),
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

  it("shows a V2-only recovery notice for legacy packs", async () => {
    vi.mocked(contentCycleApi.getContentPack).mockResolvedValue({
      contract_version: "content-v1",
      id: "pack-1",
    } as never);
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockRejectedValue(new Error("not used"));

    render(<ContentPackReviewGate packId="pack-1" />);
    expect(
      await screen.findByText(
        "Legacy Content V1 pack is outside the active workflow.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Content" })).toBeTruthy();
    expect(screen.queryByText("Review drafts")).toBeNull();
  });
});

describe("ContentV2ReviewWorkspace", () => {
  it("renders the caption and approval action without technical history for a first draft", async () => {
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockResolvedValue(WORKSPACE);
    const { submitItemDecision } = await import("@/lib/api/content-review");
    vi.mocked(submitItemDecision).mockResolvedValue({
      decision: { decision: "approved", id: "dec-1" },
      publication_candidate: null,
    } as never);

    render(<ContentV2ReviewWorkspace packId="pack-1" />);

    expect(await screen.findByText("جرب الكشري اليوم")).toBeTruthy();
    expect(screen.queryByText(/history/i)).toBeNull();
    expect(screen.queryByText(/alt text/i)).toBeNull();
    expect(screen.queryByText(/version 2/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("places ready library visuals inside the post media chooser", async () => {
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockResolvedValue({
      ...WORKSPACE,
      media_library: [
        {
          id: "media-1",
          contract_version: "content-v2",
          business_id: "biz-1",
          content_cycle_id: "cycle-1",
          owner_user_id: "owner-1",
          kind: "owner_uploaded",
          status: "ready",
          mime_type: "image/png",
          size_bytes: 100,
          width: 1080,
          height: 1080,
          checksum: "c".repeat(64),
          storage_key: null,
          failure_code: null,
          created_at: VERSION.created_at,
          updated_at: VERSION.created_at,
        },
      ],
    });

    render(<ContentV2ReviewWorkspace packId="pack-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Choose from library" }),
    );
    expect(
      await screen.findByRole("button", { name: /Uploaded image/ }),
    ).toBeTruthy();
  });

  it("does not offer edit controls for a candidate-frozen approved item", async () => {
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockResolvedValue({
      ...WORKSPACE,
      pack: { ...WORKSPACE.pack, status: "approved" },
      items: [
        {
          ...WORKSPACE.items[0],
          decision: {
            id: "decision-1",
            content_item_id: "item-1",
            content_item_version_id: VERSION.id,
            content_item_version: VERSION.version,
            content_item_version_checksum: VERSION.version_checksum,
            decision: "approved",
            revision_notes: null,
            decided_by_user_id: "owner-1",
            decided_at: VERSION.created_at,
          },
        },
      ],
    });

    render(<ContentV2ReviewWorkspace packId="pack-1" />);

    expect(await screen.findByText("جرب الكشري اليوم")).toBeTruthy();
    expect(await screen.findByText("This pack is approved")).toBeTruthy();
    expect(await screen.findByText("Approved and locked.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit caption" })).toBeNull();
    expect(screen.queryByRole("button", { name: "AI rewrite" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Choose from library" }),
    ).toBeNull();
  });

  it("reloads the approved item before finishing the approval action", async () => {
    vi.clearAllMocks();
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    const approvedWorkspace = {
      ...WORKSPACE,
      pack: { ...WORKSPACE.pack, status: "approved" as const },
      items: [
        {
          ...WORKSPACE.items[0],
          decision: {
            id: "decision-1",
            content_item_id: "item-1",
            content_item_version_id: VERSION.id,
            content_item_version: VERSION.version,
            content_item_version_checksum: VERSION.version_checksum,
            decision: "approved" as const,
            revision_notes: null,
            decided_by_user_id: "owner-1",
            decided_at: VERSION.created_at,
          },
        },
      ],
    } satisfies ContentPackWorkspaceV2;
    vi.mocked(getPackWorkspaceV2)
      .mockResolvedValueOnce(WORKSPACE)
      .mockResolvedValueOnce(approvedWorkspace);
    const { submitItemDecision } = await import("@/lib/api/content-review");
    vi.mocked(submitItemDecision).mockResolvedValue({
      decision: approvedWorkspace.items[0].decision,
      publication_candidate: null,
    } as never);

    render(<ContentV2ReviewWorkspace packId="pack-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("This pack is approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(getPackWorkspaceV2).toHaveBeenCalledTimes(2);
  });

  it("reloads the authoritative workspace after a version conflict", async () => {
    vi.clearAllMocks();
    const { getPackWorkspaceV2 } = await import("@/lib/api/content-v2");
    vi.mocked(getPackWorkspaceV2).mockResolvedValue(WORKSPACE);
    const { submitItemDecision } = await import("@/lib/api/content-review");
    vi.mocked(submitItemDecision).mockRejectedValue({
      code: "CONTENT_VERSION_CONFLICT",
    });

    render(<ContentV2ReviewWorkspace packId="pack-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText("This draft changed. Refreshing…"),
    ).toBeTruthy();
    await waitFor(() => {
      expect(getPackWorkspaceV2).toHaveBeenCalledTimes(2);
    });
  });
});
