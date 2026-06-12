import { describe, expect, it } from "vitest";
import { mutateRequest } from "../request-mutator.js";
import type {
  AnthropicMessagesRequest,
  Breakpoints,
  RegionBoundaries,
} from "../types.js";

const baseRequest: AnthropicMessagesRequest = {
  model: "claude-opus-4-7",
  system: [
    { type: "text", text: "You are Claude." },
    { type: "text", text: "CLAUDE.md content here." },
  ],
  tools: [
    { name: "Read", input_schema: { type: "object" } },
    { name: "Bash", input_schema: { type: "object" } },
  ],
  messages: [
    { role: "user", content: [{ type: "text", text: "Read foo.ts" }] },
    { role: "assistant", content: [{ type: "text", text: "Sure." }] },
    { role: "user", content: [{ type: "text", text: "Now refactor." }] },
  ],
  max_tokens: 1024,
};

const breakpoints: Breakpoints = {
  prefix_hash: "a".repeat(64),
  middle_hash: "b".repeat(64),
  include_middle_breakpoint: true,
};

describe("mutateRequest", () => {
  it("adds cache_control marker to the last tool (end of prefix)", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const out = mutateRequest(baseRequest, boundaries, breakpoints);
    expect(out.tools?.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("uses the supplied prefix TTL for the prefix marker", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const out = mutateRequest(baseRequest, boundaries, breakpoints, "1h");
    expect(out.tools?.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("adds cache_control marker to the last SEMI message when middle breakpoint included", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const out = mutateRequest(baseRequest, boundaries, breakpoints);
    const lastSemiMessage = out.messages[1];
    const lastContent = lastSemiMessage?.content.at(-1);
    expect(lastContent?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("omits middle marker when include_middle_breakpoint is false", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const out = mutateRequest(baseRequest, boundaries, {
      ...breakpoints,
      include_middle_breakpoint: false,
    });
    const lastSemiMessage = out.messages[1];
    const lastContent = lastSemiMessage?.content.at(-1);
    expect(lastContent?.cache_control).toBeUndefined();
  });

  it("falls back to last system block for prefix marker when no tools present", () => {
    const systemOnlyRequest: AnthropicMessagesRequest = {
      ...baseRequest,
      tools: undefined,
    };
    const boundaries: RegionBoundaries = { middle_end_in_messages: null };
    const out = mutateRequest(systemOnlyRequest, boundaries, {
      ...breakpoints,
      include_middle_breakpoint: false,
    });
    expect(out.system?.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
  });

  it("does not mutate the original request object", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const originalJson = JSON.stringify(baseRequest);
    mutateRequest(baseRequest, boundaries, breakpoints);
    expect(JSON.stringify(baseRequest)).toBe(originalJson);
  });

  it("preserves model, max_tokens, and original message ordering", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const out = mutateRequest(baseRequest, boundaries, breakpoints);
    expect(out.model).toBe(baseRequest.model);
    expect(out.max_tokens).toBe(baseRequest.max_tokens);
    expect(out.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });

  // Regression: Claude Code pre-populates 5m cache_control markers on tools and
  // system blocks. If left in place, placing a 1h prefix after an existing 5m
  // marker violates Anthropic's ordering rule (1h must not follow 5m in the
  // tools→system→messages processing order). mutateRequest must strip all
  // existing markers before placing its own.
  describe("strips pre-existing cache_control markers before placing its own", () => {
    it("removes existing 5m markers from non-last tools when placing a 1h prefix", () => {
      const requestWithExistingMarkers: AnthropicMessagesRequest = {
        ...baseRequest,
        tools: [
          { name: "Read", input_schema: { type: "object" }, cache_control: { type: "ephemeral", ttl: "5m" } },
          { name: "Bash", input_schema: { type: "object" }, cache_control: { type: "ephemeral", ttl: "5m" } },
        ],
      };
      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      const out = mutateRequest(requestWithExistingMarkers, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      }, "1h");

      // Only the last tool should have a marker, and it must be 1h
      expect(out.tools?.[0]?.cache_control).toBeUndefined();
      expect(out.tools?.at(-1)?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    });

    it("removes existing markers from system blocks when placing prefix on last system", () => {
      const requestWithSystemMarkers: AnthropicMessagesRequest = {
        ...baseRequest,
        tools: undefined,
        system: [
          { type: "text", text: "Block A", cache_control: { type: "ephemeral", ttl: "5m" } },
          { type: "text", text: "Block B" },
        ],
      };
      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      const out = mutateRequest(requestWithSystemMarkers, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      }, "1h");

      expect(out.system?.[0]?.cache_control).toBeUndefined();
      expect(out.system?.at(-1)?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    });

    it("removes existing markers from message content blocks", () => {
      const requestWithMsgMarkers: AnthropicMessagesRequest = {
        ...baseRequest,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "5m" } }],
          },
        ],
      };
      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      const out = mutateRequest(requestWithMsgMarkers, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      });

      const content = out.messages[0]?.content;
      expect(Array.isArray(content) && (content[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
    });
  });

  // Regression: Claude Code sends parallel tool_result blocks in arbitrary order
  // (whichever file read finishes first). The Anthropic API requires tool_result
  // blocks to appear in the same order as the preceding assistant's tool_use blocks.
  // mutateRequest must transparently fix this ordering.
  describe("reorders tool_result blocks to match preceding tool_use order (400 concurrency fix)", () => {
    it("sorts scrambled tool_result blocks to match tool_use order", () => {
      const request: AnthropicMessagesRequest = {
        model: "claude-opus-4-7",
        system: [{ type: "text", text: "System." }],
        messages: [
          { role: "user", content: [{ type: "text", text: "read files" }] },
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_A", name: "Read", input: {} },
              { type: "tool_use", id: "toolu_B", name: "Read", input: {} },
              { type: "tool_use", id: "toolu_C", name: "Read", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              // Scrambled: C, A, B instead of A, B, C
              { type: "tool_result", tool_use_id: "toolu_C", content: "content C" },
              { type: "tool_result", tool_use_id: "toolu_A", content: "content A" },
              { type: "tool_result", tool_use_id: "toolu_B", content: "content B" },
            ],
          },
          { role: "assistant", content: [{ type: "text", text: "Done." }] },
          { role: "user", content: [{ type: "text", text: "thanks" }] },
        ],
        max_tokens: 1024,
      };

      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      const out = mutateRequest(request, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      });

      const userMsg = out.messages[2];
      expect(Array.isArray(userMsg?.content)).toBe(true);
      const results = userMsg!.content as any[];
      expect(results[0].tool_use_id).toBe("toolu_A");
      expect(results[1].tool_use_id).toBe("toolu_B");
      expect(results[2].tool_use_id).toBe("toolu_C");
      // Content must follow the IDs
      expect(results[0].content).toBe("content A");
      expect(results[1].content).toBe("content B");
      expect(results[2].content).toBe("content C");
    });

    it("leaves already-ordered tool_result blocks unchanged", () => {
      const request: AnthropicMessagesRequest = {
        model: "claude-opus-4-7",
        system: [{ type: "text", text: "System." }],
        messages: [
          { role: "user", content: [{ type: "text", text: "read files" }] },
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_X", name: "Read", input: {} },
              { type: "tool_use", id: "toolu_Y", name: "Read", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_X", content: "X" },
              { type: "tool_result", tool_use_id: "toolu_Y", content: "Y" },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      const out = mutateRequest(request, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      });

      const results = out.messages[2]!.content as any[];
      expect(results[0].tool_use_id).toBe("toolu_X");
      expect(results[1].tool_use_id).toBe("toolu_Y");
    });

    it("preserves non-tool_result blocks (text) in position while reordering tool_results", () => {
      const request: AnthropicMessagesRequest = {
        model: "claude-opus-4-7",
        system: [{ type: "text", text: "System." }],
        messages: [
          { role: "user", content: [{ type: "text", text: "read" }] },
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
              { type: "tool_use", id: "toolu_2", name: "Read", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "interleaved text" },
              // Reversed order
              { type: "tool_result", tool_use_id: "toolu_2", content: "two" },
              { type: "tool_result", tool_use_id: "toolu_1", content: "one" },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      const out = mutateRequest(request, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      });

      const content = out.messages[2]!.content as any[];
      // Text block stays in position 0
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("interleaved text");
      // tool_results are now sorted: toolu_1 before toolu_2
      expect(content[1].tool_use_id).toBe("toolu_1");
      expect(content[1].content).toBe("one");
      expect(content[2].tool_use_id).toBe("toolu_2");
      expect(content[2].content).toBe("two");
    });

    it("handles multiple assistant→user tool pairs in the same conversation", () => {
      const request: AnthropicMessagesRequest = {
        model: "claude-opus-4-7",
        system: [{ type: "text", text: "System." }],
        messages: [
          { role: "user", content: [{ type: "text", text: "start" }] },
          // First tool pair
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_P", name: "Read", input: {} },
              { type: "tool_use", id: "toolu_Q", name: "Read", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              // Q before P (scrambled)
              { type: "tool_result", tool_use_id: "toolu_Q", content: "Q" },
              { type: "tool_result", tool_use_id: "toolu_P", content: "P" },
            ],
          },
          // Second tool pair
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_R", name: "Bash", input: {} },
              { type: "tool_use", id: "toolu_S", name: "Bash", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              // S before R (scrambled)
              { type: "tool_result", tool_use_id: "toolu_S", content: "S" },
              { type: "tool_result", tool_use_id: "toolu_R", content: "R" },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      const out = mutateRequest(request, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      });

      // First pair: P before Q
      const pair1 = out.messages[2]!.content as any[];
      expect(pair1[0].tool_use_id).toBe("toolu_P");
      expect(pair1[1].tool_use_id).toBe("toolu_Q");

      // Second pair: R before S
      const pair2 = out.messages[4]!.content as any[];
      expect(pair2[0].tool_use_id).toBe("toolu_R");
      expect(pair2[1].tool_use_id).toBe("toolu_S");
    });

    it("does not mutate the original request when reordering", () => {
      const request: AnthropicMessagesRequest = {
        model: "claude-opus-4-7",
        system: [{ type: "text", text: "System." }],
        messages: [
          { role: "user", content: [{ type: "text", text: "read" }] },
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
              { type: "tool_use", id: "toolu_2", name: "Read", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_2", content: "two" },
              { type: "tool_result", tool_use_id: "toolu_1", content: "one" },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const originalJson = JSON.stringify(request);
      const boundaries: RegionBoundaries = { middle_end_in_messages: null };
      mutateRequest(request, boundaries, {
        ...breakpoints,
        include_middle_breakpoint: false,
      });

      // Original must not be mutated
      expect(JSON.stringify(request)).toBe(originalJson);
    });
  });
});
