export type Volatility = "STABLE" | "SEMI" | "VOLATILE";

export type CacheTier = "5m" | "1h";

export type BlockKind =
  | "system_prompt"
  | "tool_schema"
  | "claude_md"
  | "project_rules"
  | "prior_turn"
  | "tool_use_result_pair"
  | "file_read"
  | "retrieval_result"
  | "tool_output"
  | "user_message"
  | "stub";

export type ReferenceType = "tool_call" | "text_quote" | "id_mention";

// Storage / API-contract type — snake_case (CLAUDE.md naming invariant).
// `content: AnthropicContentBlock` is deferred to M2 — no consumer in M1.
export interface Block {
  id: string;
  workspace_id: string;
  session_id: string;
  kind: BlockKind;
  volatility: Volatility;
  is_pinned: boolean;
  content_hash: string;
  token_count: number;
  added_at_turn: number;
  last_referenced_at_turn: number;
  unused_turns: number;
  is_stub: boolean;
  stub_summary: string | null;
  refetch_handle: string | null;
  restored_at_turn: number | null;
}

export interface PrefixState {
  workspace_id: string;
  prefix_hash: string;
  middle_hash: string | null;
  prefix_token_count: number;
  ttl_class: CacheTier;
  cached_at_ms: number;
  last_read_at_ms: number;
  expected_expiry_ms: number;
  keepalive_pings_since_last_turn?: number;
}

export interface CachelaneConfig {
  version: 1;
  pruner: {
    enabled: boolean;
    k: number;
    mode: "default" | "conservative" | "aggressive";
  };
  keepalive: {
    policy: "off" | "static" | "adaptive" | "auto";
    interval_seconds: number;
    idle_threshold_seconds: number;
    large_prefix_threshold_tokens: number;
  };
  classification: {
    pin: string[];
    exclude: string[];
    sliding_window_turns: number;
  };
  telemetry: {
    opt_in: boolean;
    endpoint: string;
  };
  proxy: {
    port: number;
    host: string;
    drain_timeout_ms: number;
    upstream_host: string;
    upstream_port: number;
    upstream_ssl: boolean;
    upstream_path_prefix: string;
  };
  features: {
    auto_proxy: boolean;
    k_pruner: boolean;
    keepalive: boolean;
    mutation_enabled: boolean;
  };
  health: {
    fallback_warning_threshold_pct: number;
    fallback_window_turns: number;
  };
  logging: {
    level: "error" | "warn" | "info" | "debug";
    max_file_bytes: number;
    max_files: number;
  };
  compression: {
    enabled: boolean;
    mode: "lossless" | "balanced" | "aggressive";
    exclude: string[];
    json_max_array_items: number;
    compressors: {
      json: boolean;
      log: boolean;
    };
    retention: {
      enabled: boolean;
      min_original_tokens: number;
      ttl_days: number;
    };
  };
}
