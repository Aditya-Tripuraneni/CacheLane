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
    expect(out.signals).toContain("prefix_cached");
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

  it("mutated=false when request has no system blocks and no tools", () => {
    const requestNoPrefix: AnthropicMessagesRequest = {
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      max_tokens: 1024,
    };
    const input: OrchestratorInput = {
      workspace_id: "ws-1",
      session_id: "s-1",
      current_turn: 1,
      message_classifications: [cl("VOLATILE")],
      original_request: requestNoPrefix,
    };
    const tracker = new CacheStateTracker();
    const out = orchestrate(input, tracker);
    expect(out.mutated).toBe(false);
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
    const state = tracker.get("ws-1", "s-1");
    expect(state?.prefix_hash).toBe(out.prefix_hash);
    expect(state?.middle_hash).toBe(out.middle_hash);
    expect(state?.prefix_token_count).toBeGreaterThan(0);
    expect(state?.ttl_class).toBe("5m");
  });

  it("uses 1h prefix TTL when prefix token count reaches the large-prefix threshold", () => {
    const input: OrchestratorInput = {
      workspace_id: "ws-large-prefix",
      session_id: "s-1",
      current_turn: 1,
      message_classifications: [cl("VOLATILE")],
      original_request: baseRequest,
    };
    const tracker = new CacheStateTracker();
    const out = orchestrate(input, tracker, {
      policy: "auto",
      interval_seconds: 150,
      idle_threshold_seconds: 240,
      large_prefix_threshold_tokens: 1,
    });

    expect(out.request.tools?.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
    const state = tracker.get("ws-large-prefix", "s-1");
    expect(state?.ttl_class).toBe("1h");
    expect(state?.expected_expiry_ms).toBeGreaterThan(
      (state?.cached_at_ms ?? 0) + 3_500_000,
    );
  });

  it("keeps orchestration active when prefix token serialization fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const circularSchema: Record<string, unknown> = { type: "object" };
    circularSchema.self = circularSchema;
    const request: AnthropicMessagesRequest = {
      ...baseRequest,
      tools: [{ name: "Circular", input_schema: circularSchema }],
    };
    const input: OrchestratorInput = {
      workspace_id: "ws-circular-prefix",
      session_id: "s-1",
      current_turn: 1,
      message_classifications: [cl("VOLATILE")],
      original_request: request,
    };
    const tracker = new CacheStateTracker();

    const out = orchestrate(input, tracker);

    expect(out.mutated).toBe(true);
    expect(out.signals).toContain("prefix_cached");
    expect(tracker.get("ws-circular-prefix", "s-1")?.prefix_token_count).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "[cachelane] prefix token count unavailable",
      expect.any(TypeError),
    );
    warn.mockRestore();
  });

  it("middle marker absent on turn 1, present on turn 2 with identical SEMI messages", () => {
    // Turn 1: no prev state — middle breakpoint must NOT fire.
    // Placing a middle marker on turn 1 would tell Anthropic to look for a
    // cache entry that does not exist yet, so the user pays full price.
    const input: OrchestratorInput = {
      workspace_id: "ws-two-turn",
      session_id: "s-1",
      current_turn: 1,
      message_classifications: [cl("SEMI"), cl("SEMI"), cl("VOLATILE")],
      original_request: baseRequest,
    };
    const tracker = new CacheStateTracker();

    const turn1 = orchestrate(input, tracker);
    expect(turn1.request.messages[1]?.content.at(-1)?.cache_control).toBeUndefined();
    expect(turn1.signals).not.toContain("middle_cached");

    // Turn 2: same request, same middle — middle breakpoint MUST fire now.
    const turn2 = orchestrate({ ...input, current_turn: 2 }, tracker);
    expect(turn2.request.messages[1]?.content.at(-1)?.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
    expect(turn2.signals).toContain("middle_cached");
  });

  it("middle marker absent on turn 2 when SEMI content changes between turns", () => {
    // If the middle region changes, the cached prefix no longer matches —
    // promoting the middle breakpoint would point to a boundary Anthropic
    // won't honour, charging the user full price.
    const tracker = new CacheStateTracker();

    const turn1Input: OrchestratorInput = {
      workspace_id: "ws-changed-middle",
      session_id: "s-1",
      current_turn: 1,
      message_classifications: [cl("SEMI"), cl("SEMI"), cl("VOLATILE")],
      original_request: baseRequest,
    };
    orchestrate(turn1Input, tracker);

    const differentMiddleRequest: AnthropicMessagesRequest = {
      ...baseRequest,
      messages: [
        { role: "user",      content: [{ type: "text", text: "different" }] },
        { role: "assistant", content: [{ type: "text", text: "response"  }] },
        { role: "user",      content: [{ type: "text", text: "new"       }] },
      ],
    };
    const turn2 = orchestrate(
      { ...turn1Input, current_turn: 2, original_request: differentMiddleRequest },
      tracker,
    );
    expect(turn2.request.messages[1]?.content.at(-1)?.cache_control).toBeUndefined();
  });

  it("does not mutate the original request object", () => {
    // If the original is silently modified, the fail-open path would return
    // a request that already has stale cache markers on it.
    const input: OrchestratorInput = {
      workspace_id: "ws-immutable",
      session_id: "s-1",
      current_turn: 1,
      message_classifications: [cl("SEMI"), cl("SEMI"), cl("VOLATILE")],
      original_request: baseRequest,
    };
    const originalJson = JSON.stringify(baseRequest);
    orchestrate(input, new CacheStateTracker());
    expect(JSON.stringify(baseRequest)).toBe(originalJson);
  });
});
