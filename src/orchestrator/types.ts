import type { PrefixState, TtlClass } from "../types/index.js";
import type { Classification } from "../classifier/index.js";

export type AnthropicCacheControl = { type: "ephemeral"; ttl: TtlClass };

export type AnthropicTextContent = {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicToolResultContent = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicMessageContent =
  | AnthropicTextContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent;

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: AnthropicMessageContent[];
};

export type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: unknown;
  cache_control?: AnthropicCacheControl;
};

export type AnthropicMessagesRequest = {
  model: string;
  system?: AnthropicSystemBlock[];
  tools?: AnthropicTool[];
  messages: AnthropicMessage[];
  max_tokens: number;
};

export type OrchestratorInput = {
  workspace_id: string;
  session_id: string;
  current_turn: number;
  // One Classification per message (index-aligned with original_request.messages).
  // Comes straight from M2's classifyBlocks(); the orchestrator reads .volatility
  // for boundary-finding and ignores the other fields in M3 (M5 K-pruner will
  // consume .kind and .isPinned). System + tools are always treated as STABLE
  // by the orchestrator — they live in the prefix region by API convention.
  message_classifications: Classification[];
  original_request: AnthropicMessagesRequest;
};

export type RegionBoundaries = {
  // Index in messages[] *after* the last SEMI message; null if no SEMI messages.
  // Prefix lives entirely outside messages[] (in system + tools).
  middle_end_in_messages: number | null;
};

export type Breakpoints = {
  prefix_hash: string;
  middle_hash: string | null;
  include_middle_breakpoint: boolean;
};

export type MutatedRequest = {
  request: AnthropicMessagesRequest;
  mutated: boolean;
  prefix_hash: string;
  middle_hash: string | null;
  signals: string[];
};

export type { Classification };

export type { PrefixState };
