import { describe, expect, it, vi } from "vitest";
import {
  CacheStateTracker,
  orchestrate,
} from "../index.js";
import type { Volatility } from "../../types/index.js";
import type { Classification } from "../../classifier/index.js";
import type {
  AnthropicMessagesRequest,
  OrchestratorInput,
} from "../types.js";

function cl(volatility: Volatility): Classification {
  return {
    kind: "user_message",
    volatility,
    isPinned: false,
    signals: ["user_message"],
  };
}

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

describe("orchestrate (integration)", () => {
  it("happy path: returns mutated=true and a cache_control marker on the prefix", () => {
    const input: OrchestratorInput = {
      workspace_id: "ws-1",
      session_id: "s-1",
      current_turn: 5,
      message_classifications: [cl("SEMI"), cl("SEMI"), cl("VOLATILE")],
      original_request: baseRequest,
    };
    const tracker = new CacheStateTracker();
    const out = orchestrate(input, tracker);
    expect(out.mutated).toBe(true);
    expect(out.request.tools?.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
    expect(out.prefix_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fail-open: bad input returns the original unmutated request with error signal", () => {
    // Silence the expected console.error from the fail-open log.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = {
      workspace_id: "ws-1",
      session_id: "s-1",
      current_turn: 5,
      // Deliberately wrong shape — message_classifications is not an array
      message_classifications: null as unknown as Classification[],
      original_request: baseRequest,
    } as OrchestratorInput;
    const tracker = new CacheStateTracker();
    const out = orchestrate(input, tracker);
    expect(out.mutated).toBe(false);
    expect(out.signals).toContain("error:fallback");
    expect(out.request).toEqual(baseRequest);
    spy.mockRestore();
  });

  it("updates the tracker on a successful turn", () => {
    const input: OrchestratorInput = {
      workspace_id: "ws-1",
      session_id: "s-1",
      current_turn: 5,
      message_classifications: [cl("SEMI"), cl("SEMI"), cl("VOLATILE")],
      original_request: baseRequest,
    };
    const tracker = new CacheStateTracker();
    const out = orchestrate(input, tracker);
    const state = tracker.get("ws-1");
    expect(state?.prefix_hash).toBe(out.prefix_hash);
    expect(state?.middle_hash).toBe(out.middle_hash);
  });
});
