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

  it("adds cache_control marker to the last SEMI message when middle breakpoint included", () => {
    const boundaries: RegionBoundaries = { middle_end_in_messages: 2 };
    const out = mutateRequest(baseRequest, boundaries, breakpoints);
    const lastSemiMessage = out.messages[1];
    const lastContent = lastSemiMessage.content.at(-1);
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
    const lastContent = lastSemiMessage.content.at(-1);
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
});
