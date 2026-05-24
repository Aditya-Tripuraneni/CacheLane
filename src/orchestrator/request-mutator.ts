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
        content: (m.content as AnthropicMessageContent[]).map((c) => ({ ...stripCc(c) })),
      };
    }),
  };

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
