import type {
  UUID,
  IsoDateTime,
} from "../discovery/prepared-discovery-contracts";
import type { StrategyObjective, ExternalBudgetMode } from "./strategy-brief";

export interface RetrievalQueryContext {
  business_type: string;
  market: string;
  locale: string;
  objective: StrategyObjective;
  funnel_stage: string;
  active_channels: string[];
  asset_capability: string[];
  team_capacity: string;
  budget_mode: ExternalBudgetMode;
  industry: string | null;
}

export const EVIDENCE_TIERS = [
  "verified_benchmark",
  "reviewed_guidance",
  "contextual_note",
  "model_synthesis",
] as const;

export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export interface SourceQuality {
  evidence_tier: EvidenceTier;
  source_references: string[];
  effective_at: IsoDateTime;
  expires_at: IsoDateTime | null;
  review_status: "approved" | "retired" | "expired";
}

export interface RetrievedKnowledgeItem {
  chunk_id: UUID;
  entry_id: UUID;
  entry_version: number;
  title: string;
  excerpt: string;
  kind: string;
  tags: Record<string, string[]>;
  relevance_score: number;
  source_quality: SourceQuality;
}

export interface KnowledgeGapItem {
  category: string;
  description: string;
  severity: "blocking" | "non_critical";
}

export interface RetrievalMetadata {
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  collection_name: string;
  retrieval_latency_ms: number;
}

export interface RetrievedKnowledgePack {
  retrieval_run_id: UUID;
  query_summary: string;
  query_context: RetrievalQueryContext;
  profile_version_id: UUID;
  brief_id: UUID;
  items: RetrievedKnowledgeItem[];
  knowledge_gaps: KnowledgeGapItem[];
  retrieval_metadata: RetrievalMetadata;
  retrieved_at: IsoDateTime;
}

export interface PlanCitation {
  citation_id: UUID;
  chunk_id: UUID;
  entry_id: UUID;
  entry_version: number;
  title: string;
  excerpt: string;
  evidence_tier: EvidenceTier;
  relevance_score: number;
}
