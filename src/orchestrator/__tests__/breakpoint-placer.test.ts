import { describe, expect, it } from "vitest";
import { placeBreakpoints } from "../breakpoint-placer.js";
import type {
  AnthropicMessagesRequest,
  PrefixState,
  RegionBoundaries,
} from "../types.js";

const baseRequest: AnthropicMessagesRequest = {
  model: "claude-opus-4-7",
  system: [{ type: "text", text: "You are Claude." }],
  tools: [{ name: "Read", input_schema: { type: "object" } }],
  messages: [
    { role: "user", content: [{ type: "text", text: "old" }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }] },
    { role: "user", content: [{ type: "text", text: "new" }] },
  ],
  max_tokens: 1024,
};

describe("placeBreakpoints", () => {
  it("computes a deterministic prefix_hash from identical inputs", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const r1 = placeBreakpoints(baseRequest, boundaries, undefined);
    const r2 = placeBreakpoints(baseRequest, boundaries, undefined);
    expect(r1.prefix_hash).toBe(r2.prefix_hash);
    expect(r1.prefix_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns middle_hash = null when middle is empty", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: null };
    const result = placeBreakpoints(baseRequest, boundaries, undefined);
    expect(result.middle_hash).toBeNull();
    expect(result.include_middle_breakpoint).toBe(false);
  });

  it("include_middle_breakpoint = false on first turn (no prevState)", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const result = placeBreakpoints(baseRequest, boundaries, undefined);
    expect(result.include_middle_breakpoint).toBe(false);
  });

  it("include_middle_breakpoint = true when prevState.middle_hash matches", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const first = placeBreakpoints(baseRequest, boundaries, undefined);
    const prevState: PrefixState = {
      workspace_id: "ws-1",
      prefix_hash: first.prefix_hash,
      middle_hash: first.middle_hash,
      prefix_token_count: 0,
      ttl_class: "5m",
      cached_at_ms: 0,
      last_read_at_ms: 0,
      expected_expiry_ms: 0,
    };
    const second = placeBreakpoints(baseRequest, boundaries, prevState);
    expect(second.include_middle_breakpoint).toBe(true);
  });

  it("include_middle_breakpoint = false when prevState.middle_hash mismatches", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const prevState: PrefixState = {
      workspace_id: "ws-1",
      prefix_hash: "deadbeef",
      middle_hash: "deadbeef",
      prefix_token_count: 0,
      ttl_class: "5m",
      cached_at_ms: 0,
      last_read_at_ms: 0,
      expected_expiry_ms: 0,
    };
    const result = placeBreakpoints(baseRequest, boundaries, prevState);
    expect(result.include_middle_breakpoint).toBe(false);
  });

  it("does not throw or infinite-loop when input_schema contains a circular reference", () => {
    const circular: Record<string, unknown> = { type: "object" };
    circular["self"] = circular;
    const requestWithCycle: AnthropicMessagesRequest = {
      ...baseRequest,
      tools: [{ name: "Cycle", input_schema: circular }],
    };
    const boundaries: RegionBoundaries = { middle_end_in_messages: null };
    expect(() =>
      placeBreakpoints(requestWithCycle, boundaries, undefined),
    ).not.toThrow();
  });
});
