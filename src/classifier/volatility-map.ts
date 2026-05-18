import type { BlockKind, Volatility } from "../types/index.js";

export const KIND_TO_VOLATILITY: Record<BlockKind, Volatility> = {
  system_prompt: "STABLE",
  tool_schema: "STABLE",
  claude_md: "STABLE",
  project_rules: "STABLE",
  prior_turn: "SEMI",
  tool_use_result_pair: "VOLATILE",
  file_read: "SEMI",
  retrieval_result: "VOLATILE",
  tool_output: "VOLATILE",
  user_message: "VOLATILE",
  stub: "STABLE",
};

export function promoteForPin(): Volatility {
  return "STABLE";
}
