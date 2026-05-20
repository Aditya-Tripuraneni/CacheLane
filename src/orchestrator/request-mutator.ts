import type {
  AnthropicCacheControl,
  AnthropicMessagesRequest,
  Breakpoints,
  RegionBoundaries,
} from "./types.js";

const PREFIX_MARKER: AnthropicCacheControl = Object.freeze({ type: "ephemeral", ttl: "5m" });
const MIDDLE_MARKER: AnthropicCacheControl = Object.freeze({ type: "ephemeral", ttl: "5m" });

export function mutateRequest(
  originalRequest: AnthropicMessagesRequest,
  boundaries: RegionBoundaries,
  breakpoints: Breakpoints,
): AnthropicMessagesRequest {
  const out: AnthropicMessagesRequest = {
    ...originalRequest,
    system: originalRequest.system?.map((s) => ({ ...s })),
    tools: originalRequest.tools?.map((t) => ({ ...t })),
    messages: originalRequest.messages.map((m) => ({
      ...m,
      content: m.content.map((c) => ({ ...c })) as typeof m.content,
    })),
  };

  // Prefix breakpoint: marker on the last tool, or the last system block if no tools.
  if (out.tools && out.tools.length > 0) {
    out.tools[out.tools.length - 1].cache_control = PREFIX_MARKER;
  } else if (out.system && out.system.length > 0) {
    out.system[out.system.length - 1].cache_control = PREFIX_MARKER;
  }

  // Middle breakpoint: marker on the last content item of the last SEMI message.
  if (
    breakpoints.include_middle_breakpoint &&
    boundaries.middle_end_in_messages !== null &&
    boundaries.middle_end_in_messages > 0
  ) {
    const lastSemiIdx = boundaries.middle_end_in_messages - 1;
    const msg = out.messages[lastSemiIdx];
    if (msg && msg.content.length > 0) {
      const lastContent = msg.content[msg.content.length - 1];
      lastContent.cache_control = MIDDLE_MARKER;
    }
  }

  return out;
}
