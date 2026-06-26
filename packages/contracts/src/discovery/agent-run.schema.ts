export type AgentRunType = "discovery_start" | "discovery_turn" | "discovery_summary";

export type AgentRunStatus = "success" | "schema_retry_success" | "failed";

export type ProviderMode = "openai" | "gemini_dev" | "mock";

export interface AgentRun {
  id: string;

  session_id?: string;

  run_type: AgentRunType;

  provider_mode: ProviderMode;

  model_name?: string;

  prompt_version: string;

  status: AgentRunStatus;

  input_hash?: string;

  input_tokens?: number;

  output_tokens?: number;

  latency_ms: number;

  output_json: Record<string, unknown>;

  error_code?: string;

  error_message?: string;

  retry_count: number;

  created_at: string;
}

export interface AgentRunCreateInput {
  session_id: string;
  run_type: AgentRunType;
  provider_mode: ProviderMode;
  prompt_version: string;
  model_name?: string;
  input_hash?: string;
  input_tokens?: number;
}

export interface AgentRunCompletionInput {
  agent_run_id: string;
  status: AgentRunStatus;
  output_json: Record<string, unknown>;
  output_tokens?: number;
  latency_ms: number;
  error_code?: string;
  error_message?: string;
  retry_count: number;
}

export const AGENT_RUN_TYPES: readonly AgentRunType[] = [
  "discovery_start",
  "discovery_turn",
  "discovery_summary",
] as const;

export const AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  "success",
  "schema_retry_success",
  "failed",
] as const;

export const PROVIDER_MODES: readonly ProviderMode[] = [
  "openai",
  "gemini_dev",
  "mock",
] as const;
