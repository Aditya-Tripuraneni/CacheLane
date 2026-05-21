export interface BenchmarkScenarioRow {
  scenario_id: string;
  session_id: string;
  turns: number;
  blocks: number;
  tool_calls: number;
  input_tokens: number;
  cache_read_tokens: number;
  baseline_cost_units: number;
  effective_cost_units: number;
  savings_ratio: number;
  cache_hit_ratio: number;
  pruned_blocks: number;
  keepalive_pings: number;
}

export interface RecordedBenchmarkReport {
  run_id: string;
  generated_at: string;
  source: {
    kind: "normalized_trace";
    provider: string | null;
    normalized_dir: string | null;
    model: string;
  };
  counts: {
    sessions: number;
    turns: number;
    blocks: number;
    tool_calls: number;
  };
  totals: {
    input_tokens: number;
    cache_read_tokens: number;
    baseline_cost_units: number;
    effective_cost_units: number;
    savings_ratio: number;
    cache_hit_ratio: number;
    pruned_blocks: number;
    keepalive_pings: number;
  };
  scenarios: BenchmarkScenarioRow[];
  privacy: {
    content_persisted: false;
  };
}
