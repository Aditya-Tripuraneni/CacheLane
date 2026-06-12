import type {
  AnthropicCacheControl,
  AnthropicMessageContent,
  AnthropicMessagesRequest,
  Breakpoints,
  PrefixState,
  RegionBoundaries,
} from "./types.js";

const MIDDLE_MARKER: AnthropicCacheControl = Object.freeze({ type: "ephemeral", ttl: "5m" });

export function mutateRequest(
  originalRequest: AnthropicMessagesRequest,
  boundaries: RegionBoundaries,
  breakpoints: Breakpoints,
  prefixTtl: PrefixState["ttl_class"] = "5m",
): AnthropicMessagesRequest {
  const prefixMarker: AnthropicCacheControl = {
    type: "ephemeral",
    ttl: prefixTtl,
  };
  // Strip ALL existing cache_control markers before placing CacheLane's own.
  // Claude Code pre-populates its own 5m markers; leaving them in creates
  // ordering violations when CacheLane places a 1h prefix marker after them
  // (Anthropic rejects: 1h must not follow 5m in tools→system→messages order).
  const stripCc = <T extends { cache_control?: unknown }>(block: T): Omit<T, "cache_control"> => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cache_control: _cc, ...rest } = block;
    return rest as Omit<T, "cache_control">;
  };

  const out: AnthropicMessagesRequest = {
    ...originalRequest,
    system: originalRequest.system?.map((s) => ({ ...stripCc(s) })),
    tools: originalRequest.tools?.map((t) => ({ ...stripCc(t) })),
    messages: originalRequest.messages.map((m) => {
      // Anthropic API allows content as a plain string; skip deep-copy in that case
      if (typeof m.content === "string") return { ...m };
      return {
        ...m,
        content: (m.content as AnthropicMessageContent[]).map((c) => ({ ...stripCc(c) })) as AnthropicMessageContent[],
      };
    }),
  };

  // FIX: Claude Code has a bug where parallel tool results are sometimes sent out of order.
  // Anthropic API rejects this with 400 "tool use concurrency issues".
  // We transparently sort the tool_result blocks to match the preceding tool_use order!
  for (let i = 1; i < out.messages.length; i++) {
    const msg = out.messages[i];
    const prevMsg = out.messages[i - 1];
    
    if (msg?.role === "user" && Array.isArray(msg.content) && prevMsg?.role === "assistant" && Array.isArray(prevMsg.content)) {
      const toolUseOrder = prevMsg.content
        .filter((c): c is any => c.type === "tool_use")
        .map(c => c.id);
        
      if (toolUseOrder.length > 0) {
        const orderMap = new Map(toolUseOrder.map((id, idx) => [id, idx]));
        
        // Extract all tool_result blocks
        const toolResults = msg.content.filter((c: any) => c.type === "tool_result");
        // Sort ONLY the tool_results based on the tool_use_id order
        toolResults.sort((a: any, b: any) => {
          const idxA = orderMap.has(a.tool_use_id) ? orderMap.get(a.tool_use_id)! : 999;
          const idxB = orderMap.has(b.tool_use_id) ? orderMap.get(b.tool_use_id)! : 999;
          return idxA - idxB;
        });
        
        // Rebuild the array by popping from our sorted toolResults queue
        msg.content = msg.content.map((c: any) => {
          if (c.type === "tool_result") {
            return toolResults.shift()!;
          }
          return c;
        });
      }
    }
  }

  // Prefix breakpoint: marker on the last tool, or the last system block if no tools.
  if (out.tools && out.tools.length > 0) {
    const lastTool = out.tools.at(-1);
    if (lastTool) lastTool.cache_control = prefixMarker;
  } else if (out.system && out.system.length > 0) {
    const lastSystem = out.system.at(-1);
    if (lastSystem) lastSystem.cache_control = prefixMarker;
  }

  // Middle breakpoint: marker on the last content item of the last SEMI message.
  if (
    breakpoints.include_middle_breakpoint &&
    boundaries.middle_end_in_messages !== null &&
    boundaries.middle_end_in_messages > 0
  ) {
    const lastSemiIdx = boundaries.middle_end_in_messages - 1;
    const msg = out.messages[lastSemiIdx];
    if (msg && Array.isArray(msg.content) && msg.content.length > 0) {
      const lastContent = msg.content.at(-1);
      if (lastContent) lastContent.cache_control = MIDDLE_MARKER;
    }
  }

  return out;
}
