import type {
  CairoTimezone,
  ContentChannel,
  ContentContractVersion,
  ContentErrorCode,
  ContentFormat,
  ContentLocale,
  IsoDateTime,
  LanguageMode,
  UUID,
} from "./content-types";

export const CONTENT_ASSET_KINDS = [
  "owner_supplied",
  "generated_static",
  "prompt_only",
] as const;
export type ContentAssetKind = (typeof CONTENT_ASSET_KINDS)[number];

export const CONTENT_ASSET_STATUSES = [
  "generating",
  "ready",
  "missing",
  "failed",
  "blocked",
] as const;
export type ContentAssetStatus = (typeof CONTENT_ASSET_STATUSES)[number];

export type ContentAsset = {
  readonly id: UUID;
  readonly content_item_version_id: UUID;
  readonly kind: ContentAssetKind;
  readonly status: ContentAssetStatus;
  readonly mime_type: string | null;
  readonly storage_key: string | null;
  readonly checksum: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly alt_text: string;
  readonly provider_name: string | null;
  readonly provider_model: string | null;
  readonly provider_request_id: string | null;
  readonly failure_code: ContentErrorCode | null;
  readonly created_at: IsoDateTime;
};

export type ContentCaptionVariant = {
  readonly locale: ContentLocale;
  readonly caption: string;
  readonly cta: string | null;
  readonly hashtags: readonly string[];
};

export type ContentRecommendedWindow = {
  readonly starts_at: IsoDateTime;
  readonly ends_at: IsoDateTime;
  readonly timezone: CairoTimezone;
};

export type ContentClaimSource = {
  readonly claim_type:
    | "business_fact"
    | "promotion"
    | "price"
    | "availability"
    | "superiority"
    | "testimonial"
    | "guarantee"
    | "regulated"
    | "competitor_comparison"
    | "branded_sponsored";
  readonly source_type: "profile" | "week_context" | "strategy";
  readonly source_path: string;
  readonly approved: boolean;
};

export type ContentShortVideoScript = {
  readonly hook: string;
  readonly scenes: readonly {
    readonly order: number;
    readonly visual_direction: string;
    readonly voiceover: string | null;
    readonly on_screen_text: string | null;
  }[];
  readonly closing_cta: string | null;
};

export type ContentGenerationProvenance = {
  readonly generation_run_id: UUID;
  readonly provider_name: string;
  readonly provider_model: string;
  readonly generated_at: IsoDateTime;
};

export type ContentItemVersion = {
  readonly id: UUID;
  readonly contract_version: ContentContractVersion;
  readonly content_item_id: UUID;
  readonly content_pack_id: UUID;
  readonly version: number;
  readonly channel: ContentChannel;
  readonly format: ContentFormat;
  readonly language_mode: LanguageMode;
  readonly strategy_trace: {
    readonly strategy_id: UUID;
    readonly strategy_version: number;
    readonly week_number: number;
    readonly pillar_ids: readonly UUID[];
    readonly objective: string;
    readonly channel: ContentChannel;
  };
  readonly caption_variants: readonly ContentCaptionVariant[];
  readonly cta: string | null;
  readonly hashtags: readonly string[];
  readonly creative_brief: string;
  readonly alt_text: string;
  readonly short_video_script: ContentShortVideoScript | null;
  readonly recommended_publish_window: ContentRecommendedWindow;
  readonly claim_sources: readonly ContentClaimSource[];
  readonly warnings: readonly ContentErrorCode[];
  readonly blockers: readonly ContentErrorCode[];
  readonly asset_required: boolean;
  readonly asset_ids: readonly UUID[];
  readonly generation_provenance: ContentGenerationProvenance;
  readonly version_checksum: string;
  readonly created_at: IsoDateTime;
};

export type ContentItem = {
  readonly id: UUID;
  readonly content_pack_id: UUID;
  readonly current_version_id: UUID;
  readonly status:
    | "draft"
    | "revision_requested"
    | "revising"
    | "approved"
    | "rejected"
    | "revision_failed";
  readonly created_at: IsoDateTime;
};

export type ContentDecision = {
  readonly id: UUID;
  readonly content_item_id: UUID;
  readonly content_item_version_id: UUID;
  readonly content_item_version: number;
  readonly content_item_version_checksum: string;
  readonly decision: "approved" | "rejected" | "revision_requested";
  readonly revision_notes: string | null;
  readonly decided_by_user_id: UUID;
  readonly decided_at: IsoDateTime;
};
