import type { BlockKind, Volatility } from "../types/index.js";

// Stub is intentionally absent: stubs inherit the volatility of the block
// they replaced (see index.ts). Encoding the absence in the key type makes
// it impossible to accidentally consult the map for a stub.
export const KIND_TO_VOLATILITY: Record<
  Exclude<BlockKind, "stub">,
  Volatility
> = {
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
};

// A pin always promotes to STABLE (per K-pruning invariant I6 in designs/04
// where `is_pinned || STABLE` is the exemption predicate). Encoded as a
// constant — a zero-arg function returning a literal was misleading.
export const PIN_VOLATILITY: Volatility = "STABLE";
