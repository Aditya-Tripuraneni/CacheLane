import type { CachelaneStats, SessionSummaryRow } from "../storage/index.js";

export interface ReportTurn {
  turn_number: number;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  effective_cost_units: number;
  baseline_cost_units: number; // naive: input + cache_read priced at 1.0x (un-cached)
  mutated: boolean;
  stable_count: number;
  semi_count: number;
  volatile_count: number;
  pruned_blocks_count: number;
  prune_decisions: { block_id: string; action: string; reason: string; kind: string }[];
  signals: string[];
}

export interface ReportData {
  generated_at: string;
  scope: "session" | "workspace" | "all";
  workspace_id: string | null;
  session_id: string | null;
  long_session_threshold_turns: number; // 15 (roadmap §T4)
  stats: CachelaneStats;
  turns: ReportTurn[];
  sessions: SessionSummaryRow[];
  privacy: { content_persisted: false };
}

export interface ReportOptions {
  scope: "session" | "workspace" | "all";
  workspace_id: string;
  session_id: string;
  since_ms?: number;
  generated_at: string;
}
