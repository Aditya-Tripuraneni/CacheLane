import type {
  BlockKind,
  CachelaneConfig,
  Volatility,
} from "../types/index.js";

export type UnclassifiedBlock = {
  content: string;
  role?: "system" | "user" | "assistant" | "tool";
  kindHint?: BlockKind;
  incomingVolatility?: Volatility;
  filePath?: string;
  mtimeMs?: number;
  toolName?: string;
  isToolUseResultPair?: boolean;
  turnNumber: number;
  currentTurn: number;
};

// Fixed signal vocabulary. Narrowing to a union catches typos at compile
// time and lets the orchestrator/server pattern-match without surprises.
export type Signal =
  | "stub:passthrough"
  | "claude_md"
  | "project_rules"
  | "system_prompt"
  | "tool_schema"
  | "file_read"
  | "tool_use_result_pair"
  | "prior_turn"
  | "retrieval_result"
  | "tool_output"
  | "user_message"
  | "pin:match"
  | "error:fallback"
  | "fallback:default";

// Classification is an in-process working type (never persisted, never on
// the wire). Per CLAUDE.md naming invariant, in-process types use camelCase.
export type Classification = {
  kind: BlockKind;
  volatility: Volatility;
  isPinned: boolean;
  signals: Signal[];
};

// Alias of the storage-boundary shape — snake_case is correct here because
// these fields come straight out of the loaded config.json. Aliasing rather
// than redeclaring eliminates drift between the two.
export type ClassifierConfig = CachelaneConfig["classification"];
