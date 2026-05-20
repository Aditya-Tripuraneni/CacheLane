// scripts/corpus/types.ts
//
// Types for the M4 reference-detection corpus pipeline.
// Vocabulary is kept aligned with Systems Design §3.1–3.2 (snake_case, the
// 11-value BlockKind, STABLE|SEMI|VOLATILE). Do NOT let this drift — it is the
// same drift surface that bit M1.

export type Volatility = "STABLE" | "SEMI" | "VOLATILE";

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

/** A single tool invocation made by the assistant in its response. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/**
 * A context block as the detector will see it. This intentionally mirrors the
 * subset of Systems Design §3.1 Block that reference detection needs. The full
 * Block lives in src/types; here we only carry what Signals 1–3 read.
 */
export interface CorpusBlock {
  id: string; // ULID (or any stable id) — matches blocks.id
  id_token: string; // 8-char prefix injected for Signal 2 (REQ-F-024)
  kind: BlockKind;
  file_path?: string; // present for file_read / tool_output tied to a path
  content: string; // canonical text content (what Signal 3 shingles over)
}

/** One assistant turn plus the prompt state that produced it. */
export interface CorpusTurn {
  turn_number: number;
  assistant_text: string; // concatenated text blocks of the assistant response
  tool_calls: ToolCall[]; // tool_use blocks in the assistant response
  blocks_in_prompt: CorpusBlock[]; // blocks present in the prompt this turn
}

export type LabelSource =
  | "mechanical:tool_call" // Signal-1-equivalent ground truth (deterministic)
  | "mechanical:id_mention" // Signal-2-equivalent ground truth (deterministic)
  | "judge" // LLM judge labeled the fuzzy residual
  | "human"; // human anchor label (calibration set)

/** Ground-truth label for one (turn, block) pair. */
export interface BlockLabel {
  turn_number: number;
  block_id: string;
  referenced: boolean;
  source: LabelSource;
  reason: string;
}

export interface LabeledSession {
  session_id: string;
  source_path: string;
  cwd?: string;
  turns: CorpusTurn[];
  labels: BlockLabel[];
}

/** A row handed to the LLM judge / human for the residual decision. */
export interface ResidualRow {
  session_id: string;
  turn_number: number;
  block_id: string;
}

export function isExplicit(source: LabelSource): boolean {
  return source === "mechanical:tool_call" || source === "mechanical:id_mention";
}
