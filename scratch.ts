import { AnthropicMessagesRequest } from "./src/orchestrator/types.js";
import { BlockRow } from "./src/storage/types.js";
import { PromptBlockPlacement } from "./src/pruner/types.js";

export function computeBlockPlacements(
  messages: AnthropicMessagesRequest["messages"],
  blocks: BlockRow[]
): PromptBlockPlacement[] {
  const placements: PromptBlockPlacement[] = [];
  const blockMap = new Map(blocks.map(b => [b.id, b]));

  for (let mIdx = 0; mIdx < messages.length; mIdx++) {
    const msg = messages[mIdx];
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (let cIdx = 0; cIdx < msg.content.length; cIdx++) {
        const c = msg.content[cIdx];
        if (c.type === "tool_result" && c.tool_use_id) {
          const row = blockMap.get(c.tool_use_id);
          if (row) {
            placements.push({
              block_id: row.id,
              message_index: mIdx,
              content_index: cIdx,
              kind: row.kind,
              volatility: row.volatility,
              is_pinned: row.is_pinned === 1,
              refetch_handle: row.refetch_handle,
              restored_at_turn: row.restored_at_turn
            });
          }
        }
      }
    }
  }
  return placements;
}
