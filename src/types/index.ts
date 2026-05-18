export type Volatility = "STABLE" | "SEMI" | "VOLATILE";

export type TtlClass = "short" | "long";

export type BlockKind =
  | "system_prompt"
  | "tool_schema"
  | "project_rule"
  | "prior_turn"
  | "file_read"
  | "tool_output"
  | "retrieval"
  | "user_message"
  | "stub";

export type ReferenceType = "tool_call" | "text_quote" | "id_mention";

export interface Block {
  id: string;
  kind: BlockKind;
  volatility: Volatility;
  tokenCount: number;
  contentHash: string;
  unusedTurns: number;
  isStub: boolean;
  refetchHandle?: string;
}

export interface PrefixState {
  workspaceId: string;
  prefixHash: string;
  middleHash: string;
  prefixTokenCount: number;
  ttlClass: TtlClass;
  cachedAtMs: number;
  lastReadAtMs: number;
  expectedExpiryMs: number;
}

export interface CachelaneConfig {
  version: number;
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
    sliding_window_turns: number;
  };
  telemetry: {
    opt_in: boolean;
  };
  log_level: "trace" | "debug" | "info" | "warn" | "error";
}
